import { describe, expect, it, vi } from "vitest";
import type { ParticleInstanceRecord } from "./particle-instance-stream";
import { WebGL2ParticleInstanceBuffer } from "./webgl2-particle-instance-buffer";

function record(birthTime: number): ParticleInstanceRecord {
	return {
		a: [1, 0, 0],
		b: [0, 0, 0],
		birthTime,
		c: [0, 0, 0],
		finalScale: 1,
		finalTranslucency: 1,
		lifespan: 4,
		offset: [0, 0, 0],
		origin: [0, 0, 0],
		startScale: 1,
		startTranslucency: 0,
	};
}

function fakeGl() {
	const calls = {
		bufferData: vi.fn(),
		bufferSubData: vi.fn(),
		divisors: [] as number[],
		pointers: [] as number[],
	};
	const gl = {
		ARRAY_BUFFER: 1,
		DYNAMIC_DRAW: 2,
		FLOAT: 3,
		bindBuffer: () => undefined,
		bufferData: calls.bufferData,
		bufferSubData: calls.bufferSubData,
		createBuffer: () => ({}) as WebGLBuffer,
		deleteBuffer: () => undefined,
		enableVertexAttribArray: () => undefined,
		vertexAttribDivisor: (location: number) => calls.divisors.push(location),
		vertexAttribPointer: (location: number) => calls.pointers.push(location),
	} as unknown as WebGL2RenderingContext;
	return { calls, gl };
}

describe("WebGL2ParticleInstanceBuffer", () => {
	it("uploads every record and reports the instance count", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		expect(buffer.upload([record(0), record(1)])).toBe(2);
		expect(calls.bufferSubData).toHaveBeenCalledTimes(1);
	});

	it("grows capacity by doubling and never reallocates for a smaller frame", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		buffer.upload(Array.from({ length: 40 }, (_, index) => record(index)));
		const allocations = calls.bufferData.mock.calls.length;

		// Particle counts oscillate every frame; shrinking would reallocate immediately.
		buffer.upload([record(0)]);
		expect(calls.bufferData.mock.calls.length).toBe(allocations);
	});

	it("uploads nothing for an empty cohort", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		expect(buffer.upload([])).toBe(0);
		expect(calls.bufferSubData).not.toHaveBeenCalled();
	});

	it("binds all six per-instance attributes with a divisor", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		buffer.bindAttributes();

		// Locations 3-8, matching the vertex stage's declarations.
		expect(calls.pointers).toEqual([3, 4, 5, 6, 7, 8]);
		expect(calls.divisors).toEqual([3, 4, 5, 6, 7, 8]);
	});

	it("refuses use after destruction", () => {
		const { gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);
		buffer.destroy();

		expect(() => buffer.upload([record(0)])).toThrow("destroyed");
	});
});
