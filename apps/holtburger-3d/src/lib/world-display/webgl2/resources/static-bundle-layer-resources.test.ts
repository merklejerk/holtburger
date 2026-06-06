import { describe, expect, it } from "vitest";

import type { StaticObjectBundleArtifact } from "../../static-bundle-layer";
import {
	commitWebgl2StaticBundleProductResources,
	createWebgl2StaticBundleLayerResourceStore,
	destroyWebgl2StaticBundleLayerResources,
	evictWebgl2StaticBundleProductResources,
} from "./static-bundle-layer-resources";

describe("static bundle layer WebGL2 resources", () => {
	it("uploads layer-owned texture pages and static geometry buffers", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer();

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
		});

		const resource = [...store.layersByKey.values()][0];
		expect(resource?.key).toBe("static-layer:revision-a");
		expect(resource?.texturePages).toHaveLength(2);
		expect(
			resource?.materialRecords[0]?.textureBindings.map((binding) => [
				binding.virtualRefKey,
				binding.texturePageKey,
				binding.rect,
			]),
		).toEqual([
			["base-ref", "base-page", [0, 0, 1, 1]],
			["index-ref", "index-page", [0.25, 0, 0.75, 1]],
		]);
		expect(resource?.compactedBatches[0]?.indexType).toBe(gl.UNSIGNED_SHORT);
		expect(resource?.directEntries[0]?.indexType).toBe(gl.UNSIGNED_INT);
		expect(
			gl.textureUploads.map((upload) => [
				upload.internalFormat,
				upload.format,
				upload.width,
				upload.height,
				byteLength(upload.data),
			]),
		).toEqual([
			[gl.RGBA8, gl.RGBA, 2, 1, 8],
			[gl.R8, gl.RED, 4, 1, 4],
		]);
		expect(gl.bufferUploads.map((upload) => upload.byteLength)).toEqual([
			36, 36, 24, 6, 36, 36, 24, 12,
		]);
		expect(gl.enabledAttributes).toEqual([0, 1, 0, 1]);
	});

	it("reuses resident resources until the layer revision changes", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer();

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
		});
		const first = [...store.layersByKey.values()][0];

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
		});

		expect([...store.layersByKey.values()][0]).toBe(first);
		expect(gl.createdTextures).toHaveLength(2);

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [{ ...layer, sourceRevision: "revision-b" }],
		});

		expect([...store.layersByKey.keys()]).toEqual(["static-layer:revision-b"]);
		expect(gl.createdTextures).toHaveLength(4);
		expect(gl.deletedTextures).toHaveLength(2);
	});

	it("updates color page samplers on filtering changes without rebuilding geometry", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer();

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
			textureFilteringMode: "linear",
		});
		const resource = [...store.layersByKey.values()][0];
		expect(resource?.texturePages.map((page) => page.samplerPolicyKey)).toEqual(
			[
				"sample=rgba-color;filter=linear;mips=on;aniso=1",
				"sample=indexed-data;filter=exact;mips=off;aniso=1",
			],
		);
		expect(gl.generatedMipmapCount).toBe(1);

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
			textureFilteringMode: "nearest",
		});

		expect([...store.layersByKey.values()][0]).toBe(resource);
		expect(gl.createdTextures).toHaveLength(2);
		expect(gl.createdBuffers).toHaveLength(8);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});
		expect(resource?.texturePages.map((page) => page.samplerPolicyKey)).toEqual(
			[
				"sample=rgba-color;filter=nearest;mips=off;aniso=1",
				"sample=indexed-data;filter=exact;mips=off;aniso=1",
			],
		);
	});

	it("commits, reuses, and evicts product-owned static bundle resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const productKey = createProductKey();
		const layer = createLayer();

		const product = commitWebgl2StaticBundleProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			layers: [layer],
			textureFilteringMode: "linear",
		});

		expect(store.productsByKey.size).toBe(1);
		expect(product.layerKeys).toEqual(["static-layer:revision-a"]);
		expect(store.layersByKey.size).toBe(1);
		expect(gl.createdTextures).toHaveLength(2);

		const reused = commitWebgl2StaticBundleProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			layers: [layer],
			textureFilteringMode: "nearest",
		});

		expect(reused).toBe(product);
		expect(gl.createdTextures).toHaveLength(2);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});

		commitWebgl2StaticBundleProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			layers: [{ ...layer, sourceRevision: "revision-b" }],
		});

		expect([...store.layersByKey.keys()]).toEqual(["static-layer:revision-b"]);
		expect(gl.deletedTextures).toHaveLength(2);
		expect(gl.createdTextures).toHaveLength(4);

		evictWebgl2StaticBundleProductResources({ store, productKey });

		expect(store.productsByKey.size).toBe(0);
		expect(store.layersByKey.size).toBe(0);
		expect(gl.deletedTextures).toHaveLength(4);
	});

	it("applies anisotropy to color page samplers", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer();

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 8,
		});

		expect(gl.generatedMipmapCount).toBe(1);
		expect(gl.textureFloatParameters).toEqual([
			{ pname: gl.TEXTURE_MAX_ANISOTROPY_EXT, param: 4 },
		]);
		expect(
			[...store.layersByKey.values()][0]?.texturePages.map(
				(page) => page.samplerPolicyKey,
			),
		).toEqual([
			"sample=rgba-color;filter=anisotropic-4x;mips=on;aniso=4",
			"sample=indexed-data;filter=exact;mips=off;aniso=1",
		]);
	});

	it("keeps nearest color page uploads non-mipped", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [createLayer()],
			textureFilteringMode: "nearest",
			maxAnisotropy: 8,
		});

		expect(gl.generatedMipmapCount).toBe(0);
		expect(gl.textureFloatParameters).toEqual([
			{ pname: gl.TEXTURE_MAX_ANISOTROPY_EXT, param: 1 },
		]);
		expect(
			[...store.layersByKey.values()][0]?.texturePages.map(
				(page) => page.samplerPolicyKey,
			),
		).toEqual([
			"sample=rgba-color;filter=nearest;mips=off;aniso=1",
			"sample=indexed-data;filter=exact;mips=off;aniso=1",
		]);
	});

	it("keeps exact page samplers exact under filtering changes", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer({
			materialRecords: [
				{
					key: "material",
					familyKey: "indexed-paletted",
					texturePageRefKeys: ["index-ref"],
					isTransparent: false,
				},
			],
			texturePages: [
				{
					key: "index-page",
					scopeKey: "scope",
					pageKind: "single-entry",
					usageBucket: "indexed-texels",
					sampleClass: "indexed-data",
					indexedFormat: "p8",
					width: 4,
					height: 1,
					bytes: new Uint8Array([0, 1, 2, 3]),
					entries: [
						{
							virtualRefKey: "index-ref",
							sourceAssetId: "surface",
							rect: [0, 0, 1, 1],
						},
					],
				},
			],
		});

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
			textureFilteringMode: "linear",
		});
		const parameterCount = gl.textureParameters.length;

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
			textureFilteringMode: "nearest",
		});

		expect(gl.textureParameters).toHaveLength(parameterCount);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MAG_FILTER,
			param: gl.NEAREST,
		});
	});

	it("releases all resident layer resources on destroy", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [createLayer()],
		});
		destroyWebgl2StaticBundleLayerResources(store);

		expect(store.layersByKey.size).toBe(0);
		expect(gl.deletedTextures).toHaveLength(2);
		expect(gl.deletedBuffers).toHaveLength(8);
		expect(gl.deletedVertexArrays).toHaveLength(2);
	});

	it("uploads 16-bit indexed texture pages as two-channel byte textures", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer({
			materialRecords: [
				{
					key: "material",
					familyKey: "indexed-paletted",
					texturePageRefKeys: ["index16-ref"],
					isTransparent: false,
				},
			],
			texturePages: [
				{
					key: "index16-page",
					scopeKey: "scope",
					pageKind: "single-entry",
					usageBucket: "indexed-texels",
					sampleClass: "indexed-data",
					indexedFormat: "index16",
					width: 2,
					height: 2,
					bytes: new Uint8Array([0, 0, 1, 0, 0, 1, 1, 1]),
					entries: [
						{
							virtualRefKey: "index16-ref",
							sourceAssetId: "surface",
							rect: [0, 0, 1, 1],
						},
					],
				},
			],
		});

		commitStaticBundleTestProductResources({
			gl: gl.asContext(),
			store,
			layers: [layer],
		});

		expect(
			gl.textureUploads.map((upload) => [
				upload.internalFormat,
				upload.format,
				upload.width,
				upload.height,
				byteLength(upload.data),
			]),
		).toEqual([[gl.RG8, gl.RG, 2, 2, 8]]);
	});

	it("rejects texture pages whose bytes do not match their upload format", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer({
			texturePages: [
				{
					key: "bad-index-page",
					scopeKey: "scope",
					pageKind: "single-entry",
					usageBucket: "indexed-texels",
					sampleClass: "indexed-data",
					width: 2,
					height: 2,
					bytes: new Uint8Array(16),
					entries: [
						{
							virtualRefKey: "base-ref",
							sourceAssetId: "surface",
							rect: [0, 0, 1, 1],
						},
					],
				},
			],
		});

		expect(() =>
			commitStaticBundleTestProductResources({
				gl: gl.asContext(),
				store,
				layers: [layer],
			}),
		).toThrow(
			"Static bundle indexed texture page bad-index-page is missing indexedFormat.",
		);
	});

	it("rejects 16-bit indexed texture pages with one byte per texel", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2StaticBundleLayerResourceStore();
		const layer = createLayer({
			texturePages: [
				{
					key: "bad-index16-page",
					scopeKey: "scope",
					pageKind: "single-entry",
					usageBucket: "indexed-texels",
					sampleClass: "indexed-data",
					indexedFormat: "index16",
					width: 2,
					height: 2,
					bytes: new Uint8Array(4),
					entries: [
						{
							virtualRefKey: "base-ref",
							sourceAssetId: "surface",
							rect: [0, 0, 1, 1],
						},
					],
				},
			],
		});

		expect(() =>
			commitStaticBundleTestProductResources({
				gl: gl.asContext(),
				store,
				layers: [layer],
			}),
		).toThrow(
			"Static bundle texture page bad-index16-page expected 8 bytes for 2x2 indexed-data, got 4.",
		);
	});
});

function commitStaticBundleTestProductResources({
	gl,
	store,
	layers,
	textureFilteringMode,
	maxAnisotropy,
}: Omit<
	Parameters<typeof commitWebgl2StaticBundleProductResources>[0],
	"productKey"
>): void {
	commitWebgl2StaticBundleProductResources({
		gl,
		store,
		productKey: createProductKey(),
		layers,
		textureFilteringMode,
		maxAnisotropy,
	});
}

function createLayer(
	overrides: Partial<StaticObjectBundleArtifact> = {},
): StaticObjectBundleArtifact {
	return {
		artifactKind: "static-object-bundle",
		key: "static-layer",
		scope: {
			kind: "landblock",
			landblockId: 0x1234,
			bundleKind: "outdoor-buildings",
		},
		landblockId: 0x1234,
		bundleKind: "outdoor-buildings",
		sourceRevision: "revision-a",
		rootAssetIds: ["landblock/00001234/outdoor"],
		preparedAssetIds: [],
		renderChunks: [
			{
				key: "chunk",
				landblockId: 0x1234,
				bounds: null,
			},
		],
		compactedBatches: [
			{
				key: "compacted",
				renderChunkKey: "chunk",
				familyKey: "rgba-texture-page",
				materialRecordKey: "material",
				objectKeys: ["object-a", "object-b"],
				positions: createPositions(),
				normals: createNormals(),
				uvs: createUvs(),
				indices: new Uint16Array([0, 1, 2]),
			},
		],
		directEntries: [
			{
				key: "direct",
				renderChunkKey: "chunk",
				materialRecordKey: "material",
				objectKey: "object-c",
				positions: createPositions(),
				normals: createNormals(),
				uvs: createUvs(),
				indices: new Uint32Array([0, 1, 2]),
				bounds: null,
			},
		],
		materialRecords: [
			{
				key: "material",
				familyKey: "rgba-texture-page",
				texturePageRefKeys: ["base-ref", "index-ref"],
				isTransparent: false,
			},
		],
		texturePageRefs: [
			{
				key: "base-ref",
				sourceAssetId: "base-surface",
				usageBucket: "base-color",
				sampleClass: "rgba-color",
				width: 2,
				height: 1,
				wrapS: "clamp",
				wrapT: "clamp",
				samplingDomain: "color",
				lookup: "color-filtered",
			},
			{
				key: "index-ref",
				sourceAssetId: "index-surface",
				usageBucket: "indexed-texels",
				sampleClass: "indexed-data",
				indexedFormat: "p8",
				width: 4,
				height: 1,
				wrapS: "clamp",
				wrapT: "clamp",
				samplingDomain: "data",
				lookup: "exact",
			},
			{
				key: "index16-ref",
				sourceAssetId: "surface",
				usageBucket: "indexed-texels",
				sampleClass: "indexed-data",
				indexedFormat: "index16",
				width: 2,
				height: 2,
				wrapS: "clamp",
				wrapT: "clamp",
				samplingDomain: "data",
				lookup: "exact",
			},
		],
		texturePages: [
			{
				key: "base-page",
				scopeKey: "scope",
				pageKind: "single-entry",
				usageBucket: "base-color",
				sampleClass: "rgba-color",
				width: 2,
				height: 1,
				bytes: new Uint8Array(8),
				entries: [
					{
						virtualRefKey: "base-ref",
						sourceAssetId: "base-surface",
						rect: [0, 0, 1, 1],
					},
				],
			},
			{
				key: "index-page",
				scopeKey: "scope",
				pageKind: "packed-atlas",
				usageBucket: "indexed-texels",
				sampleClass: "indexed-data",
				indexedFormat: "p8",
				width: 4,
				height: 1,
				bytes: new Uint8Array(4),
				entries: [
					{
						virtualRefKey: "index-ref",
						sourceAssetId: "index-surface",
						rect: [0.25, 0, 0.75, 1],
					},
				],
			},
		],
		objectRecords: [],
		diagnostics: {
			sourceObjectCount: 0,
			compactedSurfaceCount: 1,
			directSurfaceCount: 1,
			skippedSurfaceCount: 0,
			missingAssetIds: [],
			skippedReasons: [],
		},
		...overrides,
	};
}

function createProductKey() {
	return {
		landblockId: 0x1234,
		product: "outdoor" as const,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
	};
}

function createPositions(): Float32Array {
	return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

function createNormals(): Float32Array {
	return new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
}

function createUvs(): Float32Array {
	return new Float32Array([0, 0, 1, 0, 0, 1]);
}

function byteLength(data: TexImageSource | ArrayBufferView | null): number {
	return ArrayBuffer.isView(data) ? data.byteLength : 0;
}

class FakeWebgl2 {
	readonly ARRAY_BUFFER = 0x8892;
	readonly ELEMENT_ARRAY_BUFFER = 0x8893;
	readonly STATIC_DRAW = 0x88e4;
	readonly FLOAT = 0x1406;
	readonly UNSIGNED_BYTE = 0x1401;
	readonly UNSIGNED_SHORT = 0x1403;
	readonly UNSIGNED_INT = 0x1405;
	readonly TEXTURE_2D = 0x0de1;
	readonly TEXTURE_WRAP_S = 0x2802;
	readonly TEXTURE_WRAP_T = 0x2803;
	readonly TEXTURE_MIN_FILTER = 0x2801;
	readonly TEXTURE_MAG_FILTER = 0x2800;
	readonly CLAMP_TO_EDGE = 0x812f;
	readonly NEAREST = 0x2600;
	readonly LINEAR = 0x2601;
	readonly LINEAR_MIPMAP_LINEAR = 0x2703;
	readonly TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
	readonly RGBA = 0x1908;
	readonly RED = 0x1903;
	readonly RG = 0x8227;
	readonly RGBA8 = 0x8058;
	readonly R8 = 0x8229;
	readonly RG8 = 0x822b;
	readonly createdTextures: WebGLTexture[] = [];
	readonly deletedTextures: WebGLTexture[] = [];
	readonly createdBuffers: WebGLBuffer[] = [];
	readonly deletedBuffers: WebGLBuffer[] = [];
	readonly createdVertexArrays: WebGLVertexArrayObject[] = [];
	readonly deletedVertexArrays: WebGLVertexArrayObject[] = [];
	readonly textureUploads: {
		internalFormat: GLenum;
		format: GLenum;
		width: number;
		height: number;
		data: TexImageSource | ArrayBufferView | null;
	}[] = [];
	readonly textureParameters: { pname: GLenum; param: GLenum }[] = [];
	readonly textureFloatParameters: { pname: GLenum; param: number }[] = [];
	readonly bufferUploads: { target: GLenum; byteLength: number }[] = [];
	readonly enabledAttributes: number[] = [];
	generatedMipmapCount = 0;

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	createTexture(): WebGLTexture {
		const texture = {};
		this.createdTextures.push(texture as WebGLTexture);
		return texture as WebGLTexture;
	}

	bindTexture(): void {
		return;
	}

	texImage2D(
		_target: GLenum,
		_level: number,
		internalFormat: GLenum,
		width: number,
		height: number,
		_border: number,
		format: GLenum,
		_type: GLenum,
		data: TexImageSource | ArrayBufferView | null,
	): void {
		this.textureUploads.push({
			internalFormat,
			format,
			width,
			height,
			data,
		});
	}

	texParameteri(_target: GLenum, pname: GLenum, param: GLenum): void {
		this.textureParameters.push({ pname, param });
	}

	texParameterf(_target: GLenum, pname: GLenum, param: number): void {
		this.textureFloatParameters.push({ pname, param });
	}

	generateMipmap(): void {
		this.generatedMipmapCount += 1;
	}

	getExtension(name: string): { TEXTURE_MAX_ANISOTROPY_EXT: GLenum } | null {
		return name === "EXT_texture_filter_anisotropic"
			? { TEXTURE_MAX_ANISOTROPY_EXT: this.TEXTURE_MAX_ANISOTROPY_EXT }
			: null;
	}

	deleteTexture(texture: WebGLTexture): void {
		this.deletedTextures.push(texture);
	}

	createBuffer(): WebGLBuffer {
		const buffer = {};
		this.createdBuffers.push(buffer as WebGLBuffer);
		return buffer as WebGLBuffer;
	}

	bindBuffer(): void {
		return;
	}

	bufferData(target: GLenum, data: BufferSource | null): void {
		this.bufferUploads.push({
			target,
			byteLength: data?.byteLength ?? 0,
		});
	}

	deleteBuffer(buffer: WebGLBuffer): void {
		this.deletedBuffers.push(buffer);
	}

	createVertexArray(): WebGLVertexArrayObject {
		const vertexArray = {};
		this.createdVertexArrays.push(vertexArray as WebGLVertexArrayObject);
		return vertexArray as WebGLVertexArrayObject;
	}

	bindVertexArray(): void {
		return;
	}

	enableVertexAttribArray(index: number): void {
		this.enabledAttributes.push(index);
	}

	vertexAttribPointer(): void {
		return;
	}

	deleteVertexArray(vertexArray: WebGLVertexArrayObject): void {
		this.deletedVertexArrays.push(vertexArray);
	}
}
