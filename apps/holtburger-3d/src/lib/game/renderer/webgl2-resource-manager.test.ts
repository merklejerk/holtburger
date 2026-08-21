import { describe, expect, it, vi } from "vitest";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import { TERRAIN_COLOR_CODE_ATTRIBUTE } from "./webgl2-terrain-program";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";

describe("WebGL2ResourceManager terrain geometry", () => {
	it("uploads authored terrain codes as one unsigned integer component", () => {
		const gl = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl.context);
		const terrainColorCodes = new Uint8Array([
			0,
			Math.floor(TERRAIN_TYPE_COUNT / 2),
			TERRAIN_TYPE_COUNT - 1,
		]);

		resources.createGeometry({
			indices: new Uint16Array([0, 1, 2]),
			kind: "terrain",
			normals: new Float32Array(9),
			positions: new Float32Array(9),
			terrainColorCodes,
			textureCoordinates: new Float32Array(6),
		});

		expect(gl.bufferData).toHaveBeenCalledWith(
			gl.context.ARRAY_BUFFER,
			terrainColorCodes,
			gl.context.STATIC_DRAW,
		);
		expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(
			TERRAIN_COLOR_CODE_ATTRIBUTE,
		);
		expect(gl.vertexAttribIPointer).toHaveBeenCalledWith(
			TERRAIN_COLOR_CODE_ATTRIBUTE,
			1,
			gl.context.UNSIGNED_BYTE,
			0,
			0,
		);
	});

	it("rejects a terrain code stream whose count does not match its vertices", () => {
		const gl = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl.context);

		expect(() =>
			resources.createGeometry({
				indices: new Uint16Array([0, 1, 2]),
				kind: "terrain",
				normals: new Float32Array(9),
				positions: new Float32Array(9),
				terrainColorCodes: new Uint8Array(2),
				textureCoordinates: new Float32Array(6),
			}),
		).toThrow(/color-code count/);
	});
});

function createGeometryWebGL2(): {
	readonly context: WebGL2RenderingContext;
	readonly bufferData: ReturnType<typeof vi.fn>;
	readonly enableVertexAttribArray: ReturnType<typeof vi.fn>;
	readonly vertexAttribIPointer: ReturnType<typeof vi.fn>;
} {
	const bufferData = vi.fn();
	const enableVertexAttribArray = vi.fn();
	const vertexAttribIPointer = vi.fn();
	let nextBuffer = 0;
	return {
		context: {
			ARRAY_BUFFER: 0x8892,
			ELEMENT_ARRAY_BUFFER: 0x8893,
			FLOAT: 0x1406,
			STATIC_DRAW: 0x88e4,
			UNSIGNED_BYTE: 0x1401,
			UNSIGNED_INT: 0x1405,
			UNSIGNED_SHORT: 0x1403,
			bindBuffer: vi.fn(),
			bindVertexArray: vi.fn(),
			bufferData,
			createBuffer: vi.fn(() => ({ id: nextBuffer++ }) as WebGLBuffer),
			createVertexArray: vi.fn(
				() => ({ id: "terrain" }) as unknown as WebGLVertexArrayObject,
			),
			deleteBuffer: vi.fn(),
			deleteVertexArray: vi.fn(),
			enableVertexAttribArray,
			vertexAttribIPointer,
			vertexAttribPointer: vi.fn(),
		} as unknown as WebGL2RenderingContext,
		bufferData,
		enableVertexAttribArray,
		vertexAttribIPointer,
	};
}
