import { describe, expect, it } from "vitest";
import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	writeParticleInstance,
	type ParticleInstanceRecord,
} from "./particle-instance-stream";

const RECORD: ParticleInstanceRecord = {
	a: [7, 8, 9],
	b: [10, 11, 12],
	birthTime: 4,
	c: [13, 14, 15],
	finalScale: 17,
	finalTranslucency: 19,
	lifespan: 8,
	offset: [5, 6, 7],
	origin: [1, 2, 3],
	startScale: 16,
	startTranslucency: 18,
};

describe("writeParticleInstance", () => {
	it("packs spawn constants in the layout the vertex stage declares", () => {
		const stream = new Float32Array(PARTICLE_INSTANCE_FLOAT_COUNT);

		const next = writeParticleInstance(stream, 0, RECORD);

		expect(next).toBe(PARTICLE_INSTANCE_FLOAT_COUNT);
		expect([...stream]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
		]);
	});

	it("writes consecutive particles without gaps", () => {
		const stream = new Float32Array(PARTICLE_INSTANCE_FLOAT_COUNT * 2);

		const first = writeParticleInstance(stream, 0, RECORD);
		const second = writeParticleInstance(stream, first, {
			...RECORD,
			birthTime: 99,
		});

		expect(second).toBe(PARTICLE_INSTANCE_FLOAT_COUNT * 2);
		expect(stream[PARTICLE_INSTANCE_FLOAT_COUNT + 3]).toBe(99);
	});

	it("refuses to write past the end of the stream", () => {
		const stream = new Float32Array(PARTICLE_INSTANCE_FLOAT_COUNT - 1);

		// Silently truncating here would corrupt whichever particle followed.
		expect(() => writeParticleInstance(stream, 0, RECORD)).toThrow(
			"exceeds a 20-float stream",
		);
	});
});
