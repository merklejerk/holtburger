import type {
	StaticBundleCompactedBatch,
	StaticBundleDirectEntry,
	StaticBundleIndexedMaterialRecord,
	StaticBundleMaterialRecord,
	StaticBundleTexturePage,
	StaticObjectBundleArtifact,
	VirtualTexturePageRef,
	VirtualTexturePageSampleClass,
	VirtualTexturePageUsageBucket,
} from "../../static-bundle-layer";
import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2Texture2D,
	createWebgl2VertexArray,
	updateWebgl2Texture2DSamplerParameters,
	type Webgl2BufferResource,
	type Webgl2SamplerParameters,
	type Webgl2Texture2DResource,
	type Webgl2Texture2DUpload,
	type Webgl2VertexArrayResource,
} from "../../webgl2-gl";
import type { TextureFilteringMode } from "../../texture-pages/texture-sampling-policy";

export interface Webgl2StaticBundleLayerResourceStore {
	layersByKey: Map<string, Webgl2StaticBundleLayerResource>;
}

export interface Webgl2StaticBundleLayerResource {
	key: string;
	layerKey: string;
	landblockId: number;
	bundleKind: StaticObjectBundleArtifact["bundleKind"];
	sourceRevision: string;
	texturePages: readonly Webgl2StaticBundleTexturePageResource[];
	texturePagesByKey: ReadonlyMap<string, Webgl2StaticBundleTexturePageResource>;
	materialRecords: readonly Webgl2StaticBundleMaterialResource[];
	compactedBatches: readonly Webgl2StaticBundleGeometryResource[];
	directEntries: readonly Webgl2StaticBundleGeometryResource[];
	dispose(): void;
}

export interface Webgl2StaticBundleTexturePageResource {
	key: string;
	usageBucket: VirtualTexturePageUsageBucket;
	sampleClass: VirtualTexturePageSampleClass;
	pageKind: StaticBundleTexturePage["pageKind"];
	indexedFormat: StaticBundleTexturePage["indexedFormat"];
	samplerPolicyKey: string;
	texture: Webgl2Texture2DResource;
	entries: readonly Webgl2StaticBundleTexturePageEntryResource[];
}

interface Webgl2StaticBundleTexturePageEntryResource {
	virtualRefKey: string;
	sourceAssetId: string;
	rect: readonly [number, number, number, number];
}

export interface Webgl2StaticBundleMaterialResource {
	key: string;
	familyKey: string;
	isTransparent: boolean;
	indexedMaterial?: StaticBundleIndexedMaterialRecord;
	textureBindings: readonly Webgl2StaticBundleMaterialTextureBinding[];
}

export interface Webgl2StaticBundleMaterialTextureBinding {
	virtualRefKey: string;
	texturePageKey: string;
	usageBucket: VirtualTexturePageUsageBucket;
	sampleClass: VirtualTexturePageSampleClass;
	indexedFormat: StaticBundleTexturePage["indexedFormat"];
	rect: readonly [number, number, number, number];
	width: number;
	height: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
	texture: Webgl2Texture2DResource;
}

export interface Webgl2StaticBundleGeometryResource {
	key: string;
	renderChunkKey: string;
	materialRecordKey: string;
	objectKeys: readonly string[];
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	normalBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	dispose(): void;
}

type StaticBundleGeometryArtifact =
	| StaticBundleCompactedBatch
	| StaticBundleDirectEntry;

export function createWebgl2StaticBundleLayerResourceStore(): Webgl2StaticBundleLayerResourceStore {
	return {
		layersByKey: new Map(),
	};
}

export function syncWebgl2StaticBundleLayerResources({
	gl,
	store,
	layers,
	textureFilteringMode = "anisotropic-4x",
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2StaticBundleLayerResourceStore;
	layers: readonly StaticObjectBundleArtifact[];
	textureFilteringMode?: TextureFilteringMode;
}): void {
	const retainedResourceKeys = new Set<string>();
	for (const layer of layers) {
		const resourceKey = describeStaticBundleLayerResourceKey(layer);
		retainedResourceKeys.add(resourceKey);
		const previous = store.layersByKey.get(resourceKey);
		if (previous) {
			updateWebgl2StaticBundleLayerTexturePageSamplerPolicy({
				gl,
				layer: previous,
				textureFilteringMode,
			});
		} else {
			store.layersByKey.set(
				resourceKey,
				createWebgl2StaticBundleLayerResource({
					gl,
					layer,
					textureFilteringMode,
				}),
			);
		}
	}
	for (const [key, resource] of store.layersByKey) {
		if (!retainedResourceKeys.has(key)) {
			resource.dispose();
			store.layersByKey.delete(key);
		}
	}
}

export function destroyWebgl2StaticBundleLayerResources(
	store: Webgl2StaticBundleLayerResourceStore,
): void {
	for (const resource of store.layersByKey.values()) {
		resource.dispose();
	}
	store.layersByKey.clear();
}

function createWebgl2StaticBundleLayerResource({
	gl,
	layer,
	textureFilteringMode,
}: {
	gl: WebGL2RenderingContext;
	layer: StaticObjectBundleArtifact;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2StaticBundleLayerResource {
	const texturePages = layer.texturePages.map((page) =>
		createWebgl2StaticBundleTexturePageResource({
			gl,
			page,
			textureFilteringMode,
		}),
	);
	const texturePagesByKey = new Map(
		texturePages.map((page) => [page.key, page]),
	);
	const texturePageRefByKey = new Map(
		layer.texturePageRefs.map((ref) => [ref.key, ref]),
	);
	const texturePageByVirtualRefKey =
		createStaticBundleTexturePageByVirtualRefKey(texturePages);
	const materialRecords = layer.materialRecords.map((record) =>
		createWebgl2StaticBundleMaterialResource({
			record,
			texturePageRefByKey,
			texturePageByVirtualRefKey,
		}),
	);
	const compactedBatches = layer.compactedBatches.map((batch) =>
		createWebgl2StaticBundleGeometryResource({ gl, geometry: batch }),
	);
	const directEntries = layer.directEntries.map((entry) =>
		createWebgl2StaticBundleGeometryResource({ gl, geometry: entry }),
	);
	return {
		key: describeStaticBundleLayerResourceKey(layer),
		layerKey: layer.key,
		landblockId: layer.landblockId,
		bundleKind: layer.bundleKind,
		sourceRevision: layer.sourceRevision,
		texturePages,
		texturePagesByKey,
		materialRecords,
		compactedBatches,
		directEntries,
		dispose() {
			for (const geometry of compactedBatches) {
				geometry.dispose();
			}
			for (const geometry of directEntries) {
				geometry.dispose();
			}
			for (const page of texturePages) {
				page.texture.dispose();
			}
		},
	};
}

function describeStaticBundleLayerResourceKey(
	layer: StaticObjectBundleArtifact,
): string {
	return `${layer.key}:${layer.sourceRevision}`;
}

export function createWebgl2StaticBundleTexturePageResource({
	gl,
	page,
	textureFilteringMode = "anisotropic-4x",
}: {
	gl: WebGL2RenderingContext;
	page: StaticBundleTexturePage;
	textureFilteringMode?: TextureFilteringMode;
}): Webgl2StaticBundleTexturePageResource {
	const upload = createStaticBundleTexturePageUpload(gl, page);
	const sampler = createStaticBundleTexturePageSampler({
		gl,
		page,
		textureFilteringMode,
	});
	return {
		key: page.key,
		usageBucket: page.usageBucket,
		sampleClass: page.sampleClass,
		pageKind: page.pageKind,
		indexedFormat: page.indexedFormat,
		samplerPolicyKey: describeStaticBundleTexturePageSamplerPolicy({
			page,
			textureFilteringMode,
		}),
		texture: createWebgl2Texture2D(gl, {
			label: page.key,
			upload,
			sampler,
		}),
		entries: page.entries.map((entry) => ({
			virtualRefKey: entry.virtualRefKey,
			sourceAssetId: entry.sourceAssetId,
			rect: entry.rect,
		})),
	};
}

export function updateWebgl2StaticBundleTexturePageResourceSamplerPolicy({
	gl,
	page,
	textureFilteringMode,
}: {
	gl: WebGL2RenderingContext;
	page: Webgl2StaticBundleTexturePageResource;
	textureFilteringMode: TextureFilteringMode;
}): void {
	const nextSamplerPolicyKey = describeStaticBundleTexturePageResourceSamplerPolicy({
		page,
		textureFilteringMode,
	});
	if (page.samplerPolicyKey === nextSamplerPolicyKey) {
		return;
	}
	updateWebgl2Texture2DSamplerParameters(
		gl,
		page.texture,
		createStaticBundleTexturePageResourceSampler({
			gl,
			page,
			textureFilteringMode,
		}),
	);
	page.samplerPolicyKey = nextSamplerPolicyKey;
}

function updateWebgl2StaticBundleLayerTexturePageSamplerPolicy({
	gl,
	layer,
	textureFilteringMode,
}: {
	gl: WebGL2RenderingContext;
	layer: Webgl2StaticBundleLayerResource;
	textureFilteringMode: TextureFilteringMode;
}): void {
	for (const page of layer.texturePages) {
		updateWebgl2StaticBundleTexturePageResourceSamplerPolicy({
			gl,
			page,
			textureFilteringMode,
		});
	}
}

function createStaticBundleTexturePageUpload(
	gl: WebGL2RenderingContext,
	page: StaticBundleTexturePage,
): Webgl2Texture2DUpload {
	const format = resolveStaticBundleTexturePageUploadFormat(gl, page);
	const expectedByteLength = page.width * page.height * format.bytesPerPixel;
	if (page.bytes.byteLength !== expectedByteLength) {
		throw new Error(
			`Static bundle texture page ${page.key} expected ${expectedByteLength} bytes for ${page.width}x${page.height} ${page.sampleClass}, got ${page.bytes.byteLength}.`,
		);
	}
	return {
		width: page.width,
		height: page.height,
		internalFormat: format.internalFormat,
		format: format.format,
		type: gl.UNSIGNED_BYTE,
		data: page.bytes,
		generateMipmaps: false,
	};
}

function resolveStaticBundleTexturePageUploadFormat(
	gl: WebGL2RenderingContext,
	page: StaticBundleTexturePage,
): {
	internalFormat: GLenum;
	format: GLenum;
	bytesPerPixel: number;
} {
	switch (page.sampleClass) {
		case "rgba-color":
		case "palette-data":
			return {
				internalFormat: gl.RGBA8,
				format: gl.RGBA,
				bytesPerPixel: 4,
			};
		case "control-data":
			return {
				internalFormat: gl.R8,
				format: gl.RED,
				bytesPerPixel: 1,
			};
		case "indexed-data":
			if (page.indexedFormat === "p8") {
				return {
					internalFormat: gl.R8,
					format: gl.RED,
					bytesPerPixel: 1,
				};
			}
			if (page.indexedFormat === "index16") {
				return {
					internalFormat: gl.RG8,
					format: gl.RG,
					bytesPerPixel: 2,
				};
			}
			throw new Error(
				`Static bundle indexed texture page ${page.key} is missing indexedFormat.`,
			);
	}
}

function isExactSampleClass(
	sampleClass: VirtualTexturePageSampleClass,
): boolean {
	return sampleClass === "indexed-data" || sampleClass === "palette-data";
}

function createStaticBundleTexturePageSampler({
	gl,
	page,
	textureFilteringMode,
}: {
	gl: WebGL2RenderingContext;
	page: Pick<Webgl2StaticBundleTexturePageResource, "sampleClass">;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2SamplerParameters {
	const isExact = isExactSampleClass(page.sampleClass);
	const filter =
		isExact || textureFilteringMode === "nearest" ? gl.NEAREST : gl.LINEAR;
	return {
		wrapS: gl.CLAMP_TO_EDGE,
		wrapT: gl.CLAMP_TO_EDGE,
		minFilter: filter,
		magFilter: filter,
	};
}

function createStaticBundleTexturePageResourceSampler({
	gl,
	page,
	textureFilteringMode,
}: {
	gl: WebGL2RenderingContext;
	page: Webgl2StaticBundleTexturePageResource;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2SamplerParameters {
	return createStaticBundleTexturePageSampler({
		gl,
		page,
		textureFilteringMode,
	});
}

function describeStaticBundleTexturePageSamplerPolicy({
	page,
	textureFilteringMode,
}: {
	page: Pick<StaticBundleTexturePage, "sampleClass">;
	textureFilteringMode: TextureFilteringMode;
}): string {
	return describeArtifactTexturePageSamplerPolicy({
		sampleClass: page.sampleClass,
		textureFilteringMode,
	});
}

function describeStaticBundleTexturePageResourceSamplerPolicy({
	page,
	textureFilteringMode,
}: {
	page: Pick<Webgl2StaticBundleTexturePageResource, "sampleClass">;
	textureFilteringMode: TextureFilteringMode;
}): string {
	return describeArtifactTexturePageSamplerPolicy({
		sampleClass: page.sampleClass,
		textureFilteringMode,
	});
}

function describeArtifactTexturePageSamplerPolicy({
	sampleClass,
	textureFilteringMode,
}: {
	sampleClass: VirtualTexturePageSampleClass;
	textureFilteringMode: TextureFilteringMode;
}): string {
	const filter = isExactSampleClass(sampleClass) ? "exact" : textureFilteringMode;
	return `sample=${sampleClass};filter=${filter}`;
}

export function createStaticBundleTexturePageByVirtualRefKey(
	texturePages: readonly Webgl2StaticBundleTexturePageResource[],
): Map<string, Webgl2StaticBundleTexturePageResource> {
	const pagesByVirtualRefKey = new Map<
		string,
		Webgl2StaticBundleTexturePageResource
	>();
	for (const page of texturePages) {
		for (const entry of page.entries) {
			pagesByVirtualRefKey.set(entry.virtualRefKey, page);
		}
	}
	return pagesByVirtualRefKey;
}

export function createWebgl2StaticBundleMaterialResource({
	record,
	texturePageRefByKey,
	texturePageByVirtualRefKey,
}: {
	record: StaticBundleMaterialRecord;
	texturePageRefByKey: ReadonlyMap<string, VirtualTexturePageRef>;
	texturePageByVirtualRefKey: ReadonlyMap<
		string,
		Webgl2StaticBundleTexturePageResource
	>;
}): Webgl2StaticBundleMaterialResource {
	return {
		key: record.key,
		familyKey: record.familyKey,
		isTransparent: record.isTransparent,
		indexedMaterial: record.indexedMaterial,
		textureBindings: record.texturePageRefKeys.map((virtualRefKey) =>
			resolveStaticBundleMaterialTextureBinding({
				materialRecordKey: record.key,
				texturePageRefByKey,
				virtualRefKey,
				texturePageByVirtualRefKey,
			}),
		),
	};
}

function resolveStaticBundleMaterialTextureBinding({
	materialRecordKey,
	texturePageRefByKey,
	virtualRefKey,
	texturePageByVirtualRefKey,
}: {
	materialRecordKey: string;
	texturePageRefByKey: ReadonlyMap<string, VirtualTexturePageRef>;
	virtualRefKey: string;
	texturePageByVirtualRefKey: ReadonlyMap<
		string,
		Webgl2StaticBundleTexturePageResource
	>;
}): Webgl2StaticBundleMaterialTextureBinding {
	const ref = texturePageRefByKey.get(virtualRefKey);
	if (!ref) {
		throw new Error(
			`Static bundle material ${materialRecordKey} references missing virtual texture ref ${virtualRefKey}.`,
		);
	}
	const page = texturePageByVirtualRefKey.get(virtualRefKey);
	if (!page) {
		throw new Error(
			`Static bundle material ${materialRecordKey} references missing texture page ref ${virtualRefKey}.`,
		);
	}
	const entry = page.entries.find(
		(candidate) => candidate.virtualRefKey === virtualRefKey,
	);
	if (!entry) {
		throw new Error(
			`Static bundle texture page ${page.key} does not expose entry ${virtualRefKey}.`,
		);
	}
	return {
		virtualRefKey,
		texturePageKey: page.key,
		usageBucket: page.usageBucket,
		sampleClass: page.sampleClass,
		indexedFormat: page.indexedFormat,
		rect: entry.rect,
		width: ref.width,
		height: ref.height,
		wrapS: ref.wrapS,
		wrapT: ref.wrapT,
		texture: page.texture,
	};
}

function createWebgl2StaticBundleGeometryResource({
	gl,
	geometry,
}: {
	gl: WebGL2RenderingContext;
	geometry: StaticBundleGeometryArtifact;
}): Webgl2StaticBundleGeometryResource {
	const positionBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/positions`,
		data: toFloat32Array(geometry.positions),
	});
	const normalBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/normals`,
		data: toFloat32Array(geometry.normals),
	});
	const uvBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/uvs`,
		data: toFloat32Array(geometry.uvs),
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${geometry.key}/indices`,
		data: geometry.indices,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${geometry.key}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer.buffer);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer.buffer);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		key: geometry.key,
		renderChunkKey: geometry.renderChunkKey,
		materialRecordKey: geometry.materialRecordKey,
		objectKeys:
			"objectKeys" in geometry ? geometry.objectKeys : [geometry.objectKey],
		vertexArray,
		positionBuffer,
		normalBuffer,
		uvBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		vertexCount: geometry.positions.length / 3,
		indexCount: geometry.indices.length,
		triangleCount: geometry.indices.length / 3,
		dispose() {
			vertexArray.dispose();
			positionBuffer.dispose();
			normalBuffer.dispose();
			uvBuffer.dispose();
			indexBuffer.dispose();
		},
	};
}

function toFloat32Array(
	values: Float32Array | readonly number[],
): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}
