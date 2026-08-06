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
		a: [0, 0, 0],
		b: [0, 0, 0],
		birthrateSeconds: 0.25,
		c: [0, 0, 0],
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
		offsetDir: [0, 0, 1],
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
	it("bounds a purely linear emitter by velocity times lifespan", () => {
		// 3 m/s for 2 s, plus the particle's own unit scale.
		expect(emitterEnvelopeRadius(emitter({ a: [3, 0, 0] }))).toBeCloseTo(7);
	});

	it("accounts for acceleration, which retail's own sphere ignores", () => {
		// Retail's max(max_offset, max_a * lifespan) would return 0 here and clip the particles.
		expect(emitterEnvelopeRadius(emitter({ b: [1, 0, 0] }))).toBeGreaterThan(4);
	});

	it("includes the randomized tail of lifespan and scale, not their base values", () => {
		const base = emitterEnvelopeRadius(emitter({ a: [1, 0, 0] }));
		const randomized = emitterEnvelopeRadius(
			emitter({ a: [1, 0, 0], lifespanRand: 2, scaleRand: 1 }),
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
