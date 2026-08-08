import { PARTICLE_TYPE } from "./particle-motion";
import type { DecodedParticleEmitterInfo } from "../../assets/decode-particle-emitter-record";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { DatAssetId } from "../game-types";
import { PreparedAssetRepository } from "./prepared-asset-repository";

/**
 * An emitter retail can instantiate because it names a hardware GfxObj.
 *
 * Immutable and shared by every emitter instance that references it. Carries the exact conservative
 * motion envelope alongside the authored fields, computed once here. Retail derives its own sphere as
 * `max(max_offset, max_a * lifespan)` (acclient.c:312431-312445), which is velocity-only and
 * provably under-bounds the parabolic motion types; ours accounts for the acceleration terms too.
 */
export interface DrawableParticleEmitter {
	readonly kind: "drawable";
	readonly id: DatAssetId;
	readonly info: DecodedParticleEmitterInfo;
	/** Validated 0x01 mesh ID consumed by staging and final GPU batching. */
	readonly meshId: DatAssetId;
	/**
	 * Radius, from the emitter origin, containing every particle for its whole lifespan.
	 *
	 * Used as the emitter-granularity cull bound. Conservative by construction: it takes the
	 * maximum roll of every randomized term rather than an expected value.
	 */
	readonly envelopeRadius: number;
}

/** An authored emitter retail refuses before allocating particle state. */
interface RetailInertParticleEmitter {
	readonly kind: "retail-inert";
	readonly id: DatAssetId;
}

/** Prepared activation decision, computed once from the authored hardware-mesh ID. */
export type PreparedParticleEmitter =
	DrawableParticleEmitter | RetailInertParticleEmitter;

/** Shares immutable emitter-definition transfer/preparation over the common asset lifecycle. */
export class ParticleEmitterRepository extends PreparedAssetRepository<
	DecodedParticleEmitterInfo,
	PreparedParticleEmitter
> {
	constructor(source: ParticleEmitterSource) {
		super({
			destroySource: () => source.destroy(),
			label: "ParticleEmitterInfo",
			load: (emitterInfoId) => source.loadParticleEmitter(emitterInfoId),
			prepare: prepareParticleEmitter,
		});
	}
}

function prepareParticleEmitter(
	decoded: DecodedParticleEmitterInfo,
	expectedId: DatAssetId,
): PreparedParticleEmitter {
	if (decoded.id.toLowerCase() !== expectedId.toLowerCase()) {
		throw new Error(
			`Particle emitter source returned ${decoded.id} for ${expectedId}.`,
		);
	}
	// Retail rejects INVALID_DID before allocating the particle object or any parts
	// (`ParticleEmitter::SetInfo`, acclient.c:318011-318081). The archive authors this on 29 of
	// 2,051 emitters; staging those zero IDs would poison otherwise-valid mesh batches.
	if (decoded.hwGfxObjId === "0x00000000") {
		return { id: decoded.id, kind: "retail-inert" };
	}
	if (!decoded.hwGfxObjId.toLowerCase().startsWith("0x01")) {
		throw new Error(
			`Particle emitter ${decoded.id} hardware mesh ${decoded.hwGfxObjId} is not a GfxObj.`,
		);
	}
	return {
		envelopeRadius: emitterEnvelopeRadius(decoded),
		id: decoded.id,
		info: decoded,
		kind: "drawable",
		meshId: decoded.hwGfxObjId,
	};
}

/**
 * Maximum distance a particle can reach from the emitter origin within its lifespan.
 *
 * Motion is closed form in elapsed time, so the envelope is evaluated rather than simulated. The
 * A/B/C terms carry the linear, quadratic and cubic contributions across the shipped motion types;
 * bounding all three unconditionally is conservative for every type, including the ones that use
 * only a subset, and avoids a per-type bound table that would have to track formula changes.
 */
export function emitterEnvelopeRadius(
	info: DecodedParticleEmitterInfo,
): number {
	const lifespan = info.lifespan + Math.max(0, info.lifespanRand);
	// Each constant is scaled by a roll in [min, max], so the widest magnitude uses the larger end.
	const reach = (
		vector: readonly [number, number, number],
		minimum: number,
		maximum: number,
	) =>
		Math.hypot(vector[0], vector[1], vector[2]) *
		Math.max(Math.abs(minimum), Math.abs(maximum));
	const a = reach(info.a, info.minA, info.maxA);
	const b = reach(info.b, info.minB, info.maxB);
	const c = reach(info.c, info.minC, info.maxC);
	// A particle is a mesh, not a point, so its own scale extends the bound. `scaleRand` is additive
	// on top of the authored endpoints, matching retail's `RollDice(-1,1) * rand + base`.
	const maxScale =
		Math.max(info.startScale, info.finalScale) + Math.max(0, info.scaleRand);
	return (
		Math.abs(info.maxOffset) +
		motionReach(info.motionType, a, b, c, lifespan, Math.abs(info.maxOffset)) +
		Math.max(0, maxScale)
	);
}

/**
 * Bound the displacement each motion law can reach, by that law rather than by one polynomial.
 *
 * Summing `a·t + b·t² + c·t³` for every type over-bounds enormously wherever a constant is not a
 * polynomial coefficient. Swarm's `c` is an oscillation *amplitude* and its `b` a *frequency*; cubing
 * a lifespan against them produced a 410 m envelope for a fly swarm whose true reach is about four,
 * and 2.3 km for another. An envelope that large never culls anything, which is the opposite of what
 * it is for.
 *
 * Formulas mirror `acDisplacement` in `particle-motion.ts`; keep the two in step.
 */
function motionReach(
	motionType: number | null,
	a: number,
	b: number,
	c: number,
	lifespan: number,
	/** Widest authored spawn offset, which `Implode` derives its own `c` from. */
	maximumOffset: number,
): number {
	switch (motionType) {
		case PARTICLE_TYPE.still:
			return 0;
		case PARTICLE_TYPE.localVelocity:
		case PARTICLE_TYPE.globalVelocity:
			return a * lifespan;
		case PARTICLE_TYPE.parabolicLvga:
		case PARTICLE_TYPE.parabolicLvgaGr:
		case PARTICLE_TYPE.parabolicLvla:
		case PARTICLE_TYPE.parabolicLvlaLr:
		case PARTICLE_TYPE.parabolicGvga:
		case PARTICLE_TYPE.parabolicGvgaGr:
			return a * lifespan + 0.5 * b * lifespan * lifespan;
		case PARTICLE_TYPE.swarm:
			// `cos(b·t)·c` is bounded by `|c|` however long it runs; only `a·t` accumulates.
			return c + a * lifespan;
		case PARTICLE_TYPE.explode:
			// `c` is not the authored vector here: spawn replaces it with a unit direction, so its
			// magnitude is 1 and the authored components only bias which way particles go. Every axis
			// scales that direction by `a.x`, and z carries an extra `+a.z`; `a` bounds both.
			return b * lifespan * lifespan + 2 * a * lifespan;
		case PARTICLE_TYPE.implode:
			// `c` is likewise derived at spawn, as the offset scaled componentwise by authored `c`,
			// so the authored magnitude alone does not bound it. `maxOffset` already contributes the
			// offset's reach to the envelope, and authored `c` scales it.
			return 2 * c * maximumOffset + b * lifespan * lifespan;
		default:
			// An unshipped law has no formula in either evaluator, so nothing is drawn for it.
			return 0;
	}
}
