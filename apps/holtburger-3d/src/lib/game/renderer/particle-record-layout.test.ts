import {
	acVector3,
	landblockVector3,
	sceneVector3,
} from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	writeParticleRecord,
	type ParticleInstanceRecord,
} from "./particle-record-layout";

const RECORD: ParticleInstanceRecord = {
	a: acVector3([7, 8, 9]),
	b: acVector3([10, 11, 12]),
	birthTime: 4,
	c: acVector3([13, 14, 15]),
	finalScale: 17,
	finalTranslucency: 19,
	lifespan: 8,
	offset: acVector3([5, 6, 7]),
	landblockOrigin: sceneVector3([20, 21, 22]),
	localOrigin: landblockVector3([1, 2, 3]),
	rotation: { w: 23, x: 24, y: 25, z: 26 },
	startScale: 16,
	startTranslucency: 18,
};

describe("writeParticleRecord", () => {
	it("packs spawn constants in the layout the vertex stage declares", () => {
		const stream = new Float32Array(PARTICLE_INSTANCE_FLOAT_COUNT);

		const next = writeParticleRecord(stream, 0, RECORD);

		expect(next).toBe(PARTICLE_INSTANCE_FLOAT_COUNT);
		expect([...stream]).toEqual([
			// local origin, birth | offset, lifespan | a, b | c, appearance | landblock origin | rotation
			1,
			2, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
			21, 22, 23, 24, 25, 26,
		]);
	});

	it("writes consecutive particles without gaps", () => {
		const stream = new Float32Array(PARTICLE_INSTANCE_FLOAT_COUNT * 2);

		const first = writeParticleRecord(stream, 0, RECORD);
		const second = writeParticleRecord(stream, first, {
			...RECORD,
			birthTime: 99,
		});

		expect(second).toBe(PARTICLE_INSTANCE_FLOAT_COUNT * 2);
		expect(stream[PARTICLE_INSTANCE_FLOAT_COUNT + 3]).toBe(99);
	});

	it("refuses to write past the end of the stream", () => {
		const stream = new Float32Array(PARTICLE_INSTANCE_FLOAT_COUNT - 1);

		// Silently truncating here would corrupt whichever particle followed.
		expect(() => writeParticleRecord(stream, 0, RECORD)).toThrow(
			"exceeds a 27-float stream",
		);
	});
});
