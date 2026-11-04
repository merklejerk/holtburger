import { describe, expect, it, vi } from "vitest";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import { TERRAIN_COLOR_CODE_ATTRIBUTE } from "./webgl2-terrain-program";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	DYNAMIC_PART_SELECTOR_ATTRIBUTE,
	OBJECT_MATERIAL_SELECTOR_ATTRIBUTE,
	type DynamicGeometryData,
	type ObjectGeometryData,
} from "./geometry";
import { OBJECT_MATERIAL_TEXELS } from "./object-material-table";

describe("geometry-owned static material tables", () => {
	const geometry: ObjectGeometryData = {
		kind: "object",
		positions: new Float32Array(9),
		normals: new Float32Array(9),
		textureCoordinates: new Float32Array(6),
		indices: new Uint32Array([0, 1, 2]),
		bakedLight: null,
		materials: { count: 1, selectors: new Uint32Array(3) },
	};
	it("refreshes retained table storage and disposes it with replacement and release", () => {
		const { context: gl } = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl);
		const key = resources.createGeometry(geometry);
		const original = resources.getGeometry(key).staticMaterials;
		expect(original).toBeDefined();
		const rows = new Float32Array(OBJECT_MATERIAL_TEXELS * 4);
		resources.updateGeometryMaterials(key, rows);
		resources.updateGeometryMaterials(key, rows);
		expect(resources.getGeometry(key).staticMaterials).toBe(original);
		expect(gl.texSubImage2D).toHaveBeenCalledTimes(2);
		resources.replaceGeometry(key, geometry);
		expect(gl.deleteTexture).toHaveBeenCalledWith(original?.texture);
		const replacement = resources.getGeometry(key).staticMaterials;
		expect(replacement?.texture).not.toBe(original?.texture);
		expect(resources.releaseResource(key)).toBe(true);
		expect(gl.deleteTexture).toHaveBeenCalledWith(replacement?.texture);
		expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
	});
	it("preserves the installed generation when table allocation fails", () => {
		const { context: gl } = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl);
		const key = resources.createGeometry(geometry),
			installed = resources.getGeometry(key);
		vi.mocked(gl.texStorage2D).mockImplementationOnce(() => {
			throw new Error("allocation failed");
		});
		expect(() => resources.replaceGeometry(key, geometry)).toThrow(
			"allocation failed",
		);
		expect(resources.getGeometry(key)).toBe(installed);
		expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
		expect(gl.deleteTexture).not.toHaveBeenCalledWith(
			installed.staticMaterials?.texture,
		);
	});
	it("rejects oversized tables before allocating geometry", () => {
		const { context: gl } = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl);
		const maximumRows: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
		expect(() =>
			resources.createGeometry({
				...geometry,
				materials: { count: maximumRows + 1, selectors: new Uint32Array(3) },
			}),
		).toThrow("device limit");
		expect(gl.createBuffer).not.toHaveBeenCalled();
		expect(gl.createTexture).not.toHaveBeenCalled();
	});
	it("rejects incomplete row updates without touching retained storage", () => {
		const { context: gl } = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl);
		const key = resources.createGeometry(geometry);
		expect(() =>
			resources.updateGeometryMaterials(key, new Float32Array(0)),
		).toThrow("material rows do not match");
		expect(gl.texSubImage2D).not.toHaveBeenCalled();
	});
	it("disposes retained material textures exactly once on shutdown", async () => {
		const { context: gl } = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl);
		const key = resources.createGeometry(geometry);
		const texture = resources.getGeometry(key).staticMaterials?.texture;
		await resources.destroy();
		await resources.destroy();
		expect(gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(texture);
	});
	it("rejects selectors outside their geometry table", () => {
		const { context: gl } = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl);
		expect(() =>
			resources.createGeometry({
				...geometry,
				materials: { count: 1, selectors: new Uint32Array([0, 1, 0]) },
			}),
		).toThrow("selector exceeds");
		expect(gl.createTexture).not.toHaveBeenCalled();
	});
});

describe("WebGL2ResourceManager dynamic geometry", () => {
	const geometry: DynamicGeometryData = {
		kind: "dynamic-parts",
		partCount: 1,
		materialCount: 3,
		positions: new Float32Array(9),
		normals: new Float32Array(9),
		textureCoordinates: new Float32Array(6),
		indices: new Uint32Array([0, 1, 2]),
		partSelectors: new Uint32Array([0, 0, 0]),
		materialSelectors: new Uint32Array([2, 2, 2]),
	};
	it.each(["partCount", "materialCount"] as const)(
		"rejects oversized %s before allocation and preserves an installed resource",
		(field) => {
			const gl = createGeometryWebGL2();
			const resources = new WebGL2ResourceManager(gl.context);
			const key = resources.createGeometry(geometry);
			const installed = resources.getGeometry(key);
			vi.mocked(gl.context.createBuffer).mockClear();
			vi.mocked(gl.context.createVertexArray).mockClear();
			expect(() =>
				resources.replaceGeometry(key, { ...geometry, [field]: 5 }),
			).toThrow("requires 5 rows; device limit is 4");
			expect(gl.context.createBuffer).not.toHaveBeenCalled();
			expect(gl.context.createVertexArray).not.toHaveBeenCalled();
			expect(resources.getGeometry(key)).toBe(installed);
		},
	);
	it("accepts tables at the device row limit", () => {
		const gl = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl.context);
		expect(() =>
			resources.createGeometry({ ...geometry, partCount: 4, materialCount: 4 }),
		).not.toThrow();
	});
	it("uploads dense selectors as unsigned 32-bit integer attributes", () => {
		const gl = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl.context);
		resources.createGeometry(geometry);
		for (const [location, data] of [
			[DYNAMIC_PART_SELECTOR_ATTRIBUTE, geometry.partSelectors],
			[OBJECT_MATERIAL_SELECTOR_ATTRIBUTE, geometry.materialSelectors],
		] as const) {
			expect(gl.vertexAttribIPointer).toHaveBeenCalledWith(
				location,
				1,
				gl.context.UNSIGNED_INT,
				0,
				0,
			);
			expect(gl.bufferData).toHaveBeenCalledWith(
				gl.context.ARRAY_BUFFER,
				data,
				gl.context.STATIC_DRAW,
			);
		}
	});
	it("owns and releases exactly the uploaded dynamic vertex streams", () => {
		const gl = createGeometryWebGL2();
		const resources = new WebGL2ResourceManager(gl.context);
		const key = resources.createGeometry(geometry);
		const streams = [
			geometry.positions,
			geometry.normals,
			geometry.textureCoordinates,
			geometry.partSelectors,
			geometry.materialSelectors,
		];
		expect(gl.bufferData.mock.calls).toEqual(
			streams.map((stream) => [
				gl.context.ARRAY_BUFFER,
				stream,
				gl.context.STATIC_DRAW,
			]),
		);
		const allocated = vi
			.mocked(gl.context.createBuffer)
			.mock.results.map((result) => result.value);
		expect(allocated).toHaveLength(streams.length);
		resources.releaseResource(key);
		expect(vi.mocked(gl.context.deleteBuffer).mock.calls).toEqual(
			allocated.map((buffer) => [buffer]),
		);
		expect(gl.context.deleteVertexArray).toHaveBeenCalledTimes(1);
	});
	it.each(["partSelectors", "materialSelectors"] as const)(
		"rejects an incomplete %s stream before uploading",
		(field) => {
			const gl = createGeometryWebGL2();
			const resources = new WebGL2ResourceManager(gl.context);
			expect(() =>
				resources.createGeometry({ ...geometry, [field]: new Uint32Array(2) }),
			).toThrow("selector count");
			expect(gl.bufferData).not.toHaveBeenCalled();
		},
	);
});

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
	let nextTexture = 0;
	return {
		context: {
			createTexture: vi.fn(() => ({ id: nextTexture++ }) as WebGLTexture),
			deleteTexture: vi.fn(),
			activeTexture: vi.fn(),
			bindTexture: vi.fn(),
			texStorage2D: vi.fn(),
			texSubImage2D: vi.fn(),
			texParameteri: vi.fn(),
			ARRAY_BUFFER: 0x8892,
			MAX_TEXTURE_SIZE: 0x0d33,
			getParameter: vi.fn(() => 4),
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
