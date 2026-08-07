import { describe, expect, it } from "vitest";
import { decodeParticleEmitterRecord } from "./decode-particle-emitter-record";

function encode(overrides: Record<string, unknown> = {}): Uint8Array {
	const manifest = {
		a: [0, 0, 0],
		b: [0, 0, 0],
		birthrateSeconds: 0.25,
		byteOrder: "little-endian",
		c: [0, 0, 0],
		emitsPerMeter: false,
		emitsPerSecond: true,
		emitterInfoId: "0x3200020c",
		finalScale: 2,
		finalTrans: 1,
		followsParent: false,
		hwGfxObjId: "0x01000ff4",
		initialParticles: 2,
		isPersistent: true,
		lifespan: 4,
		lifespanRand: 0,
		maxA: 1,
		maxB: 1,
		maxC: 1,
		maxOffset: 1,
		maxParticles: 10,
		minA: 1,
		minB: 1,
		minC: 1,
		minOffset: 0,
		motionType: 2,
		offsetDir: [0, 0, 1],
		scaleRand: 0,
		startScale: 1,
		startTrans: 0,
		totalParticles: 0,
		totalSeconds: 0,
		transRand: 0,
		transport: "holtburger-particle-emitter",
		...overrides,
	};
	let body = new TextEncoder().encode(JSON.stringify(manifest));
	while ((12 + body.length) % 4 !== 0) body = Uint8Array.from([...body, 0x20]);
	const bytes = new Uint8Array(12 + body.length);
	bytes.set(new TextEncoder().encode("HBPE"), 0);
	new DataView(bytes.buffer).setUint32(4, body.length, true);
	new DataView(bytes.buffer).setUint32(8, bytes.length, true);
	bytes.set(body, 12);
	return bytes;
}

function decodeParticleMeshFixture() {
	return decodeParticleEmitterRecord(
		encode({ a: [1, 2, 3], offsetDir: [0, 0, 1] }),
		"0x3200020c",
	);
}

describe("decodeParticleEmitterRecord", () => {
	it("decodes an authored emitter and keeps its derived persistence", () => {
		const decoded = decodeParticleEmitterRecord(encode(), "0x3200020c");

		expect(decoded.id).toBe("0x3200020c");
		expect(decoded.hwGfxObjId).toBe("0x01000ff4");
		expect(decoded.motionType).toBe(2);
		expect(decoded.isPersistent).toBe(true);
	});

	it("keeps motion constants in AC's authored axes", () => {
		const decoded = decodeParticleMeshFixture();

		// Deliberately unconverted. Swarm and Explode read axis meaning from the component index,
		// so converting here would apply each rule to the wrong axis; `particlePosition` evaluates
		// in AC and converts its displacement once instead.
		expect(decoded.offsetDir).toEqual([0, 0, 1]);
		expect(decoded.a).toEqual([1, 2, 3]);
	});

	it("carries an unshipped motion type as null rather than inventing one", () => {
		expect(
			decodeParticleEmitterRecord(encode({ motionType: null }), "0x3200020c")
				.motionType,
		).toBeNull();
	});

	it("refuses an emitter that authors no emission trigger", () => {
		// Neither bit set means no particle can ever be released: a decode fault, not content.
		expect(() =>
			decodeParticleEmitterRecord(
				encode({ emitsPerMeter: false, emitsPerSecond: false }),
				"0x3200020c",
			),
		).toThrow("authors no emission trigger");
	});

	it("refuses a response served for a different emitter", () => {
		expect(() => decodeParticleEmitterRecord(encode(), "0x32000999")).toThrow(
			"returned 0x3200020c for 0x32000999",
		);
	});
});
