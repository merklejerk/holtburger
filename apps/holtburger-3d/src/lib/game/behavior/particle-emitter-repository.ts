import type { DecodedParticleEmitterInfo } from "../../assets/decode-particle-emitter-record";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { DatAssetId } from "../game-types";
import { PreparedAssetRepository } from "./prepared-asset-repository";

/**
 * Immutable prepared emitter definition, shared by every emitter instance that references it.
 *
 * Carries the exact conservative motion envelope alongside the authored fields, computed once here
 * rather than per activation. Retail derives its own sphere as
 * `max(max_offset, max_a * lifespan)` (acclient.c:312431-312445), which is velocity-only and
 * provably under-bounds the parabolic motion types; ours accounts for the acceleration terms too.
 */
export interface PreparedParticleEmitter {
	readonly id: DatAssetId;
	readonly info: DecodedParticleEmitterInfo;
	/**
	 * Radius, from the emitter origin, containing every particle for its whole lifespan.
	 *
	 * Used as the emitter-granularity cull bound. Conservative by construction: it takes the
	 * maximum roll of every randomized term rather than an expected value.
	 */
	readonly envelopeRadius: number;
}

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
	return {
		envelopeRadius: emitterEnvelopeRadius(decoded),
		id: decoded.id,
		info: decoded,
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
	const magnitude = (
		vector: readonly [number, number, number],
		scale: number,
	) =>
		Math.hypot(vector[0], vector[1], vector[2]) * Math.max(1, Math.abs(scale));
	const reach =
		Math.abs(info.maxOffset) +
		magnitude(info.a, info.maxA) * lifespan +
		magnitude(info.b, info.maxB) * lifespan * lifespan +
		magnitude(info.c, info.maxC) * lifespan * lifespan * lifespan;
	// A particle is a mesh, not a point, so its own scale extends the bound. `scaleRand` is additive
	// on top of the authored endpoints, matching retail's `RollDice(-1,1) * rand + base`.
	const maxScale =
		Math.max(info.startScale, info.finalScale) + Math.max(0, info.scaleRand);
	return reach + Math.max(0, maxScale);
}
