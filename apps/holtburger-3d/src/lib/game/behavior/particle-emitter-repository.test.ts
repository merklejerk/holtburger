import { acVector3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import type { DecodedParticleEmitterInfo } from "../../assets/decode-particle-emitter-record";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { DatAssetId } from "../game-types";
import {
	emitterCenterReach,
	maximumParticleScale,
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
		hardwareMesh: {
			id: "0x01000ff4" as DatAssetId,
			radius: 2.5,
		},
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
	constructor(readonly overrides: Partial<DecodedParticleEmitterInfo> = {}) {}
	async loadParticleEmitter(emitterInfoId: DatAssetId) {
		this.loads += 1;
		return emitter({ ...this.overrides, id: emitterInfoId });
	}
	destroy(): void {}
}

describe("emitterCenterReach", () => {
	/**
	 * Explode's `c` is replaced at spawn by a unit direction, so the authored magnitude never
	 * reaches the trajectory and must not reach the bound either.
	 */
	it("ignores the authored c magnitude for an exploding emitter", () => {
		const modest = emitterCenterReach(
			emitter({
				a: acVector3([1, 0, 0]),
				c: acVector3([1, 0, 0]),
				motionType: 6,
			}),
		);
		const enormous = emitterCenterReach(
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
		const near = emitterCenterReach(
			emitter({ c: acVector3([1, 0, 0]), maxOffset: 1, motionType: 7 }),
		);
		const far = emitterCenterReach(
			emitter({ c: acVector3([1, 0, 0]), maxOffset: 10, motionType: 7 }),
		);

		expect(far).toBeGreaterThan(near);
	});

	it("bounds a purely linear emitter by velocity times lifespan", () => {
		// 3 m/s for 2 s; drawable mesh extent is composed later with the activation hook.
		expect(
			emitterCenterReach(emitter({ a: acVector3([3, 0, 0]), motionType: 2 })),
		).toBeCloseTo(6);
	});

	it("accounts for acceleration, which retail's own sphere ignores", () => {
		// Retail's max(max_offset, max_a * lifespan) would return 0 here and clip the particles.
		// Half b t squared over 2 s is 2.
		expect(
			emitterCenterReach(emitter({ b: acVector3([1, 0, 0]), motionType: 3 })),
		).toBeCloseTo(2);
	});

	it("holds a still emitter to its offset, with no travel term at all", () => {
		expect(
			emitterCenterReach(
				emitter({ a: acVector3([9, 0, 0]), maxOffset: 2, motionType: 1 }),
			),
		).toBeCloseTo(2);
	});

	it("bounds Swarm by its oscillation amplitude rather than by a cubed lifespan", () => {
		// `c` is an amplitude and `b` a frequency, so neither accumulates with time. Treating them
		// as polynomial coefficients produced a 410 m envelope for a fly swarm reaching about four,
		// and an envelope that large never culls anything.
		const swarm = emitterCenterReach(
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

		// |c| + |a| * 5.5 + offset 1.
		expect(swarm).toBeCloseTo(1.414 + 0.55 + 1, 2);
		expect(swarm).toBeLessThan(10);
	});

	it("includes the widest lifespan tail regardless of variance sign", () => {
		const base = emitterCenterReach(
			emitter({ a: acVector3([1, 0, 0]), motionType: 2 }),
		);
		const positive = emitterCenterReach(
			emitter({ a: acVector3([1, 0, 0]), lifespanRand: 2, motionType: 2 }),
		);
		const negative = emitterCenterReach(
			emitter({ a: acVector3([1, 0, 0]), lifespanRand: -2, motionType: 2 }),
		);
		expect(positive).toBeGreaterThan(base);
		expect(negative).toBe(positive);
	});

	it("uses the largest absolute spawn-offset endpoint", () => {
		expect(
			emitterCenterReach(emitter({ maxOffset: 2, minOffset: -5 })),
		).toBeCloseTo(5);
	});
});

describe("maximumParticleScale", () => {
	it("includes additive variance and retail's upper clamp", () => {
		expect(
			maximumParticleScale(
				emitter({ finalScale: 9, scaleRand: -3, startScale: 1 }),
			),
		).toBe(10);
	});

	it("applies retail's lower clamp even to malformed negative endpoints", () => {
		expect(
			maximumParticleScale(
				emitter({ finalScale: -2, scaleRand: 0, startScale: -1 }),
			),
		).toBe(0.1);
	});
});

describe("ParticleEmitterRepository", () => {
	it("shares one preparation and exposes the derived geometric facts", async () => {
		const source = new FixtureSource();
		const repository = new ParticleEmitterRepository(source);

		const [first, second] = await Promise.all([
			repository.acquire("0x3200020c"),
			repository.acquire("0x3200020c"),
		]);

		expect(source.loads).toBe(1);
		expect(first.asset).toBe(second.asset);
		expect(first.asset.kind).toBe("drawable");
		if (first.asset.kind !== "drawable")
			throw new Error("Expected drawable fixture.");
		expect(first.asset.centerReach).toBeGreaterThanOrEqual(0);
		expect(first.asset.maximumScale).toBe(1);
		expect(first.asset.mesh).toEqual({ id: "0x01000ff4", radius: 2.5 });
		first.release();
		second.release();
		expect(repository.getDiagnostics().assetCount).toBe(0);
	});

	it("classifies retail's zero hardware mesh as intentionally inert", async () => {
		const repository = new ParticleEmitterRepository(
			new FixtureSource({ hardwareMesh: null }),
		);

		const handle = await repository.acquire("0x320003b7");

		expect(handle.asset).toEqual({
			id: "0x320003b7",
			kind: "retail-inert",
		});
		handle.release();
	});
});
