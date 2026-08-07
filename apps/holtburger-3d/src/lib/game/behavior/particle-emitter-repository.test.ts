import { acVector3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import type { DecodedParticleEmitterInfo } from "../../assets/decode-particle-emitter-record";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { DatAssetId } from "../game-types";
import {
	emitterEnvelopeRadius,
	ParticleEmitterRepository,
} from "./particle-emitter-repository";

function emitter(
	overrides: Partial<DecodedParticleEmitterInfo> = {},
): DecodedParticleEmitterInfo {
	return {
		a: acVector3([0, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthrateSeconds: 0.25,
		c: acVector3([0, 0, 0]),
		emitsPerMeter: false,
		emitsPerSecond: true,
		finalScale: 1,
		finalTrans: 1,
		followsParent: false,
		hwGfxObjId: "0x01000ff4" as DatAssetId,
		id: "0x3200020c" as DatAssetId,
		initialParticles: 2,
		isPersistent: true,
		lifespan: 2,
		lifespanRand: 0,
		maxA: 1,
		maxB: 1,
		maxC: 1,
		maxOffset: 0,
		maxParticles: 10,
		minA: 1,
		minB: 1,
		minC: 1,
		minOffset: 0,
		motionType: 1,
		offsetDir: acVector3([0, 0, 1]),
		scaleRand: 0,
		startScale: 1,
		startTrans: 0,
		totalParticles: 0,
		totalSeconds: 0,
		transRand: 0,
		...overrides,
	};
}

class FixtureSource implements ParticleEmitterSource {
	loads = 0;
	async loadParticleEmitter(emitterInfoId: DatAssetId) {
		this.loads += 1;
		return emitter({ id: emitterInfoId });
	}
	destroy(): void {}
}

describe("emitterEnvelopeRadius", () => {
	/**
	 * Explode's `c` is replaced at spawn by a unit direction, so the authored magnitude never
	 * reaches the trajectory and must not reach the bound either.
	 */
	it("ignores the authored c magnitude for an exploding emitter", () => {
		const modest = emitterEnvelopeRadius(
			emitter({
				a: acVector3([1, 0, 0]),
				c: acVector3([1, 0, 0]),
				motionType: 6,
			}),
		);
		const enormous = emitterEnvelopeRadius(
			emitter({
				a: acVector3([1, 0, 0]),
				c: acVector3([1000, 0, 0]),
				motionType: 6,
			}),
		);

		expect(enormous).toBe(modest);
	});

	/** Implode derives `c` from the spawn offset, so its reach scales with the offset. */
	it("scales an imploding emitter's bound by its spawn offset", () => {
		const near = emitterEnvelopeRadius(
			emitter({ c: acVector3([1, 0, 0]), maxOffset: 1, motionType: 7 }),
		);
		const far = emitterEnvelopeRadius(
			emitter({ c: acVector3([1, 0, 0]), maxOffset: 10, motionType: 7 }),
		);

		expect(far).toBeGreaterThan(near);
	});

	it("bounds a purely linear emitter by velocity times lifespan", () => {
		// 3 m/s for 2 s, plus the particle's own unit scale.
		expect(
			emitterEnvelopeRadius(
				emitter({ a: acVector3([3, 0, 0]), motionType: 2 }),
			),
		).toBeCloseTo(7);
	});

	it("accounts for acceleration, which retail's own sphere ignores", () => {
		// Retail's max(max_offset, max_a * lifespan) would return 0 here and clip the particles.
		// Half b t squared over 2 s is 2, plus unit scale.
		expect(
			emitterEnvelopeRadius(
				emitter({ b: acVector3([1, 0, 0]), motionType: 3 }),
			),
		).toBeCloseTo(3);
	});

	it("holds a still emitter to its offset, with no travel term at all", () => {
		expect(
			emitterEnvelopeRadius(
				emitter({ a: acVector3([9, 0, 0]), maxOffset: 2, motionType: 1 }),
			),
		).toBeCloseTo(3);
	});

	it("bounds Swarm by its oscillation amplitude rather than by a cubed lifespan", () => {
		// `c` is an amplitude and `b` a frequency, so neither accumulates with time. Treating them
		// as polynomial coefficients produced a 410 m envelope for a fly swarm reaching about four,
		// and an envelope that large never culls anything.
		const swarm = emitterEnvelopeRadius(
			emitter({
				a: acVector3([0, 0, 0.1]),
				b: acVector3([2, 2, 0.2]),
				c: acVector3([1, 1, 0]),
				lifespan: 5,
				lifespanRand: 0.5,
				maxOffset: 1,
				motionType: 5,
			}),
		);

		// |c| + |a| * 5.5 + offset 1 + scale 1.
		expect(swarm).toBeCloseTo(1.414 + 0.55 + 1 + 1, 2);
		expect(swarm).toBeLessThan(10);
	});

	it("includes the randomized tail of lifespan and scale, not their base values", () => {
		const base = emitterEnvelopeRadius(emitter({ a: acVector3([1, 0, 0]) }));
		const randomized = emitterEnvelopeRadius(
			emitter({ a: acVector3([1, 0, 0]), lifespanRand: 2, scaleRand: 1 }),
		);
		expect(randomized).toBeGreaterThan(base);
	});

	it("bounds a stationary emitter by its spawn offset and particle size", () => {
		expect(emitterEnvelopeRadius(emitter({ maxOffset: 5 }))).toBeCloseTo(6);
	});
});

describe("ParticleEmitterRepository", () => {
	it("shares one preparation and exposes the derived envelope", async () => {
		const source = new FixtureSource();
		const repository = new ParticleEmitterRepository(source);

		const [first, second] = await Promise.all([
			repository.acquire("0x3200020c"),
			repository.acquire("0x3200020c"),
		]);

		expect(source.loads).toBe(1);
		expect(first.asset).toBe(second.asset);
		expect(first.asset.envelopeRadius).toBeGreaterThan(0);
		first.release();
		second.release();
		expect(repository.getDiagnostics().assetCount).toBe(0);
	});
});
