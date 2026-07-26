import { describe, expect, it } from "vitest";
import { Mat4 } from "../math/types";
import type { StaticInstanceData } from "../systems/static-resources";
import { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import {
	OBJECT_INSTANCE_STRIDE_BYTES,
	WebGL2InstanceBuffer,
	bindWebGL2ObjectInstanceRange,
	encodeObjectInstances,
} from "./webgl2-instance-buffer";

describe("WebGL2InstanceBuffer", () => {
	it("encodes the fixed matrix/color record without property-order assumptions", () => {
		const values = encodeObjectInstances([
			instance(
				new Mat4(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16),
				[0.25, 0.5, 0.75, 1],
			),
		]);

		expect([...values]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0.25, 0.5, 0.75, 1,
		]);
	});

	it("publishes one immutable persistent stream with a complete draw binding", () => {
		const fixture = fakeGl();
		const buffer = new WebGL2InstanceBuffer(fixture.gl, "persistent-static");

		buffer.publishPersistent([instance(Mat4.identity(), [1, 1, 1, 1])]);

		expect(buffer.getBinding()).toMatchObject({
			capacity: 1,
			populatedInstanceCount: 1,
			strideBytes: OBJECT_INSTANCE_STRIDE_BYTES,
		});
		expect(fixture.bufferData).toHaveLength(1);
		expect(fixture.bufferData[0]?.usage).toBe(fixture.gl.STATIC_DRAW);
		expect(fixture.bufferData[0]?.data).toBeInstanceOf(Float32Array);
		expect(() =>
			buffer.publishPersistent([instance(Mat4.identity(), [1, 1, 1, 1])]),
		).toThrow("already been published");
	});

	it("reuses geometric frame capacity and orphans once per sequential view", () => {
		const fixture = fakeGl();
		const arena = new FrameInstanceStreamArena(fixture.gl);
		const instances = [
			instance(Mat4.identity(), [1, 0, 0, 1]),
			instance(Mat4.identity(), [0, 1, 0, 1]),
			instance(Mat4.identity(), [0, 0, 1, 1]),
		];

		arena.prepareView(instances);
		expect(arena.getDiagnostics()).toEqual({
			capacity: 4,
			growthCount: 1,
			populatedInstanceCount: 3,
			viewHighWaterMark: 3,
		});
		expect(arena.getRange(1, 2)).toMatchObject({
			firstInstance: 1,
			instanceCount: 2,
		});

		arena.prepareView(instances.slice(0, 2));
		expect(arena.getDiagnostics()).toEqual({
			capacity: 4,
			growthCount: 1,
			populatedInstanceCount: 2,
			viewHighWaterMark: 3,
		});
		expect(fixture.createdBuffers).toBe(1);
		expect(fixture.bufferData.map(({ data }) => data)).toEqual([
			4 * OBJECT_INSTANCE_STRIDE_BYTES,
			4 * OBJECT_INSTANCE_STRIDE_BYTES,
		]);
		expect(fixture.bufferSubData).toHaveLength(2);
	});

	it("binds every matrix/color attribute with offsets selecting the requested run", () => {
		const fixture = fakeGl();
		const buffer = new WebGL2InstanceBuffer(fixture.gl, "persistent-static");
		buffer.publishPersistent([
			instance(Mat4.identity(), [1, 0, 0, 1]),
			instance(Mat4.identity(), [0, 0, 1, 1]),
		]);

		bindWebGL2ObjectInstanceRange(fixture.gl, buffer.getBinding(), 1, 1);

		expect(fixture.attributePointers).toEqual([
			{ location: 3, offset: 80, stride: 80 },
			{ location: 4, offset: 96, stride: 80 },
			{ location: 5, offset: 112, stride: 80 },
			{ location: 6, offset: 128, stride: 80 },
			{ location: 7, offset: 144, stride: 80 },
		]);
		expect(fixture.attributeDivisors).toEqual([
			{ divisor: 1, location: 3 },
			{ divisor: 1, location: 4 },
			{ divisor: 1, location: 5 },
			{ divisor: 1, location: 6 },
			{ divisor: 1, location: 7 },
		]);
	});
});

function instance(
	sourceToLandblock: Mat4,
	color: readonly [number, number, number, number],
): StaticInstanceData {
	return {
		color: { a: color[3], b: color[2], g: color[1], r: color[0] },
		sourceToLandblock,
	};
}

function fakeGl(): {
	readonly gl: WebGL2RenderingContext;
	readonly attributeDivisors: Array<{ divisor: number; location: number }>;
	readonly attributePointers: Array<{
		location: number;
		offset: number;
		stride: number;
	}>;
	readonly bufferData: Array<{ data: number | Float32Array; usage: number }>;
	readonly bufferSubData: Array<{ data: Float32Array; offset: number }>;
	readonly createdBuffers: number;
} {
	let createdBuffers = 0;
	const bufferData: Array<{ data: number | Float32Array; usage: number }> = [];
	const bufferSubData: Array<{ data: Float32Array; offset: number }> = [];
	const attributePointers: Array<{
		location: number;
		offset: number;
		stride: number;
	}> = [];
	const attributeDivisors: Array<{ divisor: number; location: number }> = [];
	const gl = {
		ARRAY_BUFFER: 0x8892,
		FLOAT: 0x1406,
		STATIC_DRAW: 0x88e4,
		STREAM_DRAW: 0x88e0,
		bindBuffer: () => undefined,
		bufferData: (
			_target: number,
			data: number | Float32Array,
			usage: number,
		) => {
			bufferData.push({ data, usage });
		},
		bufferSubData: (_target: number, offset: number, data: Float32Array) => {
			bufferSubData.push({ data, offset });
		},
		createBuffer: () => {
			createdBuffers += 1;
			return {} as WebGLBuffer;
		},
		deleteBuffer: () => undefined,
		enableVertexAttribArray: () => undefined,
		vertexAttribDivisor: (location: number, divisor: number) => {
			attributeDivisors.push({ divisor, location });
		},
		vertexAttribPointer: (
			location: number,
			_size: number,
			_type: number,
			_normalized: boolean,
			stride: number,
			offset: number,
		) => {
			attributePointers.push({ location, offset, stride });
		},
	} as unknown as WebGL2RenderingContext;
	return {
		attributeDivisors,
		attributePointers,
		bufferData,
		bufferSubData,
		get createdBuffers() {
			return createdBuffers;
		},
		gl,
	};
}
