import { describe, expect, it } from "vitest";
import type { PortalPropagationMetadataStreamView } from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES } from "./portal-scope-tile-metadata";
import { WebGL2PortalPropagationMetadataBuffer } from "./webgl2-portal-propagation-metadata-buffer";

const TEST_ARRIVAL_STATE_COUNT = 3;
const TEST_BINDING_POINT = 3;
const TEST_SCOPE_STATE_COUNT = 2;

describe("WebGL2 portal propagation metadata buffer", () => {
	it("allocates once, uploads one combined prefix, and binds that generation", () => {
		const fixture = fakeWebGL2({
			maximumBlockBytes: PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			maximumBindingCount: 8,
		});
		const owner = new WebGL2PortalPropagationMetadataBuffer(fixture.gl);
		const stream = propagationStream(
			TEST_ARRIVAL_STATE_COUNT,
			TEST_SCOPE_STATE_COUNT,
		);

		expect(fixture.currentBuffer).toBe(fixture.previousBuffer);
		owner.upload(stream);
		owner.bindBase(TEST_BINDING_POINT);

		expect(fixture.allocations).toEqual([
			{
				byteLength: PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
				usage: fixture.gl.DYNAMIC_DRAW,
			},
		]);
		expect(fixture.uploads).toEqual([
			{
				bytes: stream.propagationMetadataBytes,
				length:
					PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
					TEST_SCOPE_STATE_COUNT * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
			},
		]);
		expect(fixture.baseBindings).toEqual([
			{ bindingPoint: TEST_BINDING_POINT, buffer: fixture.buffer },
		]);

		owner.destroy();
		owner.destroy();
		expect(fixture.deletedBuffers).toEqual([fixture.buffer]);
		expect(() => owner.upload(stream)).toThrow("has been destroyed");
	});

	it("rejects unsupported capacity and inconsistent state counts", () => {
		const unsupported = fakeWebGL2({
			maximumBlockBytes: PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES - 1,
			maximumBindingCount: 8,
		});
		expect(
			() => new WebGL2PortalPropagationMetadataBuffer(unsupported.gl),
		).toThrow("uniform bytes");
		expect(unsupported.createdBufferCount).toBe(0);

		const fixture = fakeWebGL2({
			maximumBlockBytes: PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			maximumBindingCount: 4,
		});
		const owner = new WebGL2PortalPropagationMetadataBuffer(fixture.gl);
		expect(() => owner.bindBase(0)).toThrow("has not been uploaded");
		expect(() => owner.upload(propagationStream(1, 2))).toThrow(
			"does not match its populated state counts",
		);
		owner.upload(propagationStream(1, 1));
		expect(() => owner.bindBase(4)).toThrow(
			"outside this device's binding range",
		);
		expect(fixture.baseBindings).toEqual([]);
	});
});

function propagationStream(
	arrivalStateCount: number,
	scopeStateCount: number,
): PortalPropagationMetadataStreamView {
	return {
		arrivalMetadataStateCount: arrivalStateCount,
		propagationMetadataBytes: new Uint8Array(
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		),
		scopeMetadataStateCount: scopeStateCount,
		usedPropagationMetadataByteLength:
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
			scopeStateCount * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
	};
}

interface FakeWebGL2Fixture {
	readonly allocations: Array<{
		readonly byteLength: number;
		readonly usage: GLenum;
	}>;
	readonly baseBindings: Array<{
		readonly bindingPoint: number;
		readonly buffer: WebGLBuffer | null;
	}>;
	readonly buffer: WebGLBuffer;
	readonly createdBufferCount: number;
	readonly currentBuffer: WebGLBuffer | null;
	readonly deletedBuffers: WebGLBuffer[];
	readonly gl: WebGL2RenderingContext;
	readonly previousBuffer: WebGLBuffer;
	readonly uploads: Array<{
		readonly bytes: Uint8Array;
		readonly length: number;
	}>;
}

function fakeWebGL2(options: {
	readonly maximumBindingCount: number;
	readonly maximumBlockBytes: number;
}): FakeWebGL2Fixture {
	const constants = {
		DYNAMIC_DRAW: 0x88e8,
		MAX_UNIFORM_BLOCK_SIZE: 0x8a30,
		MAX_UNIFORM_BUFFER_BINDINGS: 0x8a2f,
		UNIFORM_BUFFER: 0x8a11,
		UNIFORM_BUFFER_BINDING: 0x8a28,
	} as const;
	const allocations: FakeWebGL2Fixture["allocations"] = [];
	const baseBindings: FakeWebGL2Fixture["baseBindings"] = [];
	const buffer = {} as WebGLBuffer;
	let createdBufferCount = 0;
	let currentBuffer: WebGLBuffer | null;
	const deletedBuffers: WebGLBuffer[] = [];
	const previousBuffer = {} as WebGLBuffer;
	const uploads: FakeWebGL2Fixture["uploads"] = [];
	currentBuffer = previousBuffer;
	const gl = {
		...constants,
		bindBuffer: (_target: GLenum, value: WebGLBuffer | null) => {
			currentBuffer = value;
		},
		bindBufferBase: (
			_target: GLenum,
			bindingPoint: number,
			value: WebGLBuffer | null,
		) => {
			baseBindings.push({ bindingPoint, buffer: value });
		},
		bufferData: (_target: GLenum, byteLength: number, usage: GLenum) => {
			allocations.push({ byteLength, usage });
		},
		bufferSubData: (
			_target: GLenum,
			_offset: number,
			bytes: Uint8Array,
			_sourceOffset: number,
			length: number,
		) => {
			uploads.push({ bytes, length });
		},
		createBuffer: () => {
			createdBufferCount += 1;
			return buffer;
		},
		deleteBuffer: (value: WebGLBuffer) => {
			deletedBuffers.push(value);
		},
		getParameter: (parameter: GLenum) => {
			if (parameter === constants.MAX_UNIFORM_BLOCK_SIZE) {
				return options.maximumBlockBytes;
			}
			if (parameter === constants.MAX_UNIFORM_BUFFER_BINDINGS) {
				return options.maximumBindingCount;
			}
			if (parameter === constants.UNIFORM_BUFFER_BINDING) {
				return currentBuffer;
			}
			throw new Error(`Unexpected WebGL2 parameter ${parameter}.`);
		},
	} as unknown as WebGL2RenderingContext;
	return {
		allocations,
		baseBindings,
		buffer,
		get createdBufferCount() {
			return createdBufferCount;
		},
		get currentBuffer() {
			return currentBuffer;
		},
		deletedBuffers,
		gl,
		previousBuffer,
		uploads,
	};
}
