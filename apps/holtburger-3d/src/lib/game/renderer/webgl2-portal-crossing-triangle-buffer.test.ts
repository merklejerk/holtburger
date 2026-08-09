import { describe, expect, it } from "vitest";
import {
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	type PortalCrossingTriangleStreamView,
} from "./portal-crossing-triangle-stream";
import { WebGL2PortalCrossingTriangleBuffer } from "./webgl2-portal-crossing-triangle-buffer";

const TEST_VERTEX_COUNT = 3;
const TEST_CAPACITY = 12;
const TEST_PROPAGATION_DEPTH = 4;

describe("WebGL2 portal crossing triangle buffer", () => {
	it("allocates once, uploads one byte prefix, and replays one draw per round", () => {
		const fixture = fakeWebGL2();
		const owner = new WebGL2PortalCrossingTriangleBuffer(
			fixture.gl,
			TEST_CAPACITY,
		);
		const bytes = new Uint8Array(
			TEST_CAPACITY * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
		const stream: PortalCrossingTriangleStreamView = {
			bytes,
			trace: {
				arenaCapacityBytes: bytes.byteLength,
				arenaGrowthCount: 0,
				crossingInputCount: 1,
				portalOwnedFrameHeapRecordCreationCount: 0,
				positionScalarReadCount: TEST_VERTEX_COUNT * 3,
				triangleIndexReadCount: TEST_VERTEX_COUNT,
				vertexHighWaterCount: TEST_VERTEX_COUNT,
			},
			usedByteLength:
				TEST_VERTEX_COUNT * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
			vertexCount: TEST_VERTEX_COUNT,
		};

		owner.upload(stream);
		for (let round = 0; round < TEST_PROPAGATION_DEPTH; round += 1) {
			owner.draw();
		}

		expect(fixture.bufferAllocations).toEqual([
			{
				byteLength:
					TEST_CAPACITY * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
				usage: fixture.gl.DYNAMIC_DRAW,
			},
		]);
		expect(fixture.floatAttributes).toEqual([
			{
				location: 0,
				offset: 0,
				stride: PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
			},
		]);
		expect(fixture.integerAttributes).toEqual([
			{ location: 1, offset: 12 },
			{ location: 2, offset: 16 },
			{ location: 3, offset: 20 },
		]);
		expect(fixture.uploads).toEqual([
			{
				bytes,
				length: stream.usedByteLength,
			},
		]);
		expect(fixture.drawVertexCounts).toEqual(
			Array.from({ length: TEST_PROPAGATION_DEPTH }, () => TEST_VERTEX_COUNT),
		);

		owner.destroy();
		owner.destroy();
		expect(fixture.deletedBuffers).toHaveLength(1);
		expect(fixture.deletedVertexArrays).toHaveLength(1);
	});
});

interface FakeWebGL2Fixture {
	readonly bufferAllocations: Array<{
		readonly byteLength: number;
		readonly usage: number;
	}>;
	readonly drawVertexCounts: number[];
	readonly deletedBuffers: WebGLBuffer[];
	readonly deletedVertexArrays: WebGLVertexArrayObject[];
	readonly floatAttributes: Array<{
		readonly location: number;
		readonly offset: number;
		readonly stride: number;
	}>;
	readonly gl: WebGL2RenderingContext;
	readonly integerAttributes: Array<{
		readonly location: number;
		readonly offset: number;
	}>;
	readonly uploads: Array<{
		readonly bytes: Uint8Array;
		readonly length: number;
	}>;
}

function fakeWebGL2(): FakeWebGL2Fixture {
	const ARRAY_BUFFER = 0x8892;
	const ARRAY_BUFFER_BINDING = 0x8894;
	const DYNAMIC_DRAW = 0x88e8;
	const FLOAT = 0x1406;
	const TRIANGLES = 0x0004;
	const UNSIGNED_INT = 0x1405;
	const VERTEX_ARRAY_BINDING = 0x85b5;
	const buffer = {} as WebGLBuffer;
	const previousBuffer = {} as WebGLBuffer;
	const previousVertexArray = {} as WebGLVertexArrayObject;
	const vertexArray = {} as WebGLVertexArrayObject;
	const bufferAllocations: FakeWebGL2Fixture["bufferAllocations"] = [];
	const drawVertexCounts: number[] = [];
	const deletedBuffers: WebGLBuffer[] = [];
	const deletedVertexArrays: WebGLVertexArrayObject[] = [];
	const floatAttributes: FakeWebGL2Fixture["floatAttributes"] = [];
	const integerAttributes: FakeWebGL2Fixture["integerAttributes"] = [];
	const uploads: FakeWebGL2Fixture["uploads"] = [];
	const gl = {
		ARRAY_BUFFER,
		ARRAY_BUFFER_BINDING,
		DYNAMIC_DRAW,
		FLOAT,
		TRIANGLES,
		UNSIGNED_INT,
		VERTEX_ARRAY_BINDING,
		bindBuffer: () => undefined,
		bindVertexArray: () => undefined,
		bufferData: (_target: number, byteLength: number, usage: number) => {
			bufferAllocations.push({ byteLength, usage });
		},
		bufferSubData: (
			_target: number,
			_offset: number,
			bytes: Uint8Array,
			_sourceOffset: number,
			length: number,
		) => {
			uploads.push({ bytes, length });
		},
		createBuffer: () => buffer,
		createVertexArray: () => vertexArray,
		deleteBuffer: (deleted: WebGLBuffer) => {
			deletedBuffers.push(deleted);
		},
		deleteVertexArray: (deleted: WebGLVertexArrayObject) => {
			deletedVertexArrays.push(deleted);
		},
		drawArrays: (_mode: number, _first: number, count: number) => {
			drawVertexCounts.push(count);
		},
		enableVertexAttribArray: () => undefined,
		getParameter: (parameter: number) =>
			parameter === ARRAY_BUFFER_BINDING ? previousBuffer : previousVertexArray,
		vertexAttribIPointer: (
			location: number,
			_size: number,
			_type: number,
			stride: number,
			offset: number,
		) => {
			expect(stride).toBe(PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES);
			integerAttributes.push({ location, offset });
		},
		vertexAttribPointer: (
			location: number,
			_size: number,
			_type: number,
			_normalized: boolean,
			stride: number,
			offset: number,
		) => {
			floatAttributes.push({ location, offset, stride });
		},
	} as unknown as WebGL2RenderingContext;
	return {
		bufferAllocations,
		deletedBuffers,
		deletedVertexArrays,
		drawVertexCounts,
		floatAttributes,
		gl,
		integerAttributes,
		uploads,
	};
}
