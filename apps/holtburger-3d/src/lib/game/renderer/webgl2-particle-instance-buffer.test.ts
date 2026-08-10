import { acVector3, renderVector3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { ParticleInstanceRecord } from "./particle-instance-stream";
import { WebGL2ParticleInstanceBuffer } from "./webgl2-particle-instance-buffer";

function record(birthTime: number): ParticleInstanceRecord {
	return {
		a: acVector3([1, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthTime,
		c: acVector3([0, 0, 0]),
		finalScale: 1,
		finalTranslucency: 1,
		lifespan: 4,
		offset: acVector3([0, 0, 0]),
		origin: renderVector3([0, 0, 0]),
		startScale: 1,
		startTranslucency: 0,
	};
}

function fakeGl() {
	const calls = {
		bufferData: vi.fn(),
		bufferSubData: vi.fn(),
		divisors: [] as number[],
		pointers: [] as Array<{ location: number; offset: number }>,
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
		vertexAttribPointer: (
			location: number,
			_componentCount: number,
			_type: number,
			_normalized: boolean,
			_stride: number,
			offset: number,
		) => calls.pointers.push({ location, offset }),
	} as unknown as WebGL2RenderingContext;
	return { calls, gl };
}

describe("WebGL2ParticleInstanceBuffer", () => {
	it("uploads every physical batch once and reports the frame instance count", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		expect(
			buffer.prepareFrame([
				{ particles: [record(0)] },
				{ particles: [record(1)] },
			]),
		).toBe(2);
		expect(calls.bufferSubData).toHaveBeenCalledTimes(1);
	});

	it("grows capacity by doubling and never reallocates for a smaller frame", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		buffer.prepareFrame([
			{ particles: Array.from({ length: 40 }, (_, index) => record(index)) },
		]);
		const allocations = calls.bufferData.mock.calls.length;

		// Particle counts oscillate every frame; shrinking would reallocate immediately.
		buffer.prepareFrame([{ particles: [record(0)] }]);
		expect(calls.bufferData.mock.calls.length).toBe(allocations);
	});

	it("uploads nothing for an empty cohort", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		expect(buffer.prepareFrame([])).toBe(0);
		expect(calls.bufferSubData).not.toHaveBeenCalled();
	});

	it("binds all six per-instance attributes with a divisor", () => {
		const { calls, gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);

		buffer.prepareFrame([{ particles: [record(0), record(1)] }]);
		buffer.bindAttributes(1);

		// Locations 3-8, matching the vertex stage's declarations.
		expect(calls.pointers.map(({ location }) => location)).toEqual([
			3, 4, 5, 6, 7, 8,
		]);
		// One particle occupies 21 floats, so range-relative attributes start 84 bytes in.
		expect(calls.pointers[0]?.offset).toBe(84);
		expect(calls.divisors).toEqual([3, 4, 5, 6, 7, 8]);
	});

	it("refuses use after destruction", () => {
		const { gl } = fakeGl();
		const buffer = new WebGL2ParticleInstanceBuffer(gl);
		buffer.destroy();

		expect(() => buffer.prepareFrame([{ particles: [record(0)] }])).toThrow(
			"destroyed",
		);
	});
});
