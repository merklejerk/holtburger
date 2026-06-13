import type { DetailedLandblockRenderArtifacts } from "../../landblock-render-product";
import {
	formatStaticLandblockProductKey,
	type StaticLandblockProductKey,
} from "../../landblock-render-product";
import { type RenderVec4 } from "../../render-math";
import { buildPolygonSetRenderGeometry } from "../../indexed-render-geometry";
import type { StaticBundleTexturePage } from "../../static-bundle-layer";
import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2VertexArrayResource,
} from "../../webgl2-gl";
import {
	createStaticBundleTextureRefByKey,
	createStaticBundleTexturePageByVirtualRefKey,
	createWebgl2StaticBundleMaterialResource,
	createWebgl2StaticBundleTexturePageResource,
	updateWebgl2StaticBundleTexturePageResourceSamplerPolicy,
	type Webgl2StaticBundleMaterialResource,
	type Webgl2StaticBundleTexturePageResource,
} from "./static-bundle-layer-resources";
import type { TextureFilteringMode } from "../../texture-pages/texture-sampling-policy";

type DetailedStructuredInteriorCellArtifact =
	DetailedLandblockRenderArtifacts["structuredInteriorCells"][number];
type DetailedStructuredInteriorMaterialSlice =
	DetailedStructuredInteriorCellArtifact["materialSlices"][number];

export interface Webgl2StructuredInteriorResourceStore {
	productsByKey: Map<string, Webgl2StructuredInteriorProductResource>;
	productResourceKeyByProductKey: Map<string, string>;
	cellKeysByProductKey: Map<string, readonly string[]>;
	cellsByKey: Map<string, Webgl2StructuredInteriorCellResource>;
}

interface Webgl2StructuredInteriorProductResource {
	key: string;
	artifactKey: string;
	resourceSignature: string;
	texturePages: readonly Webgl2StaticBundleTexturePageResource[];
	texturePagesByKey: ReadonlyMap<string, Webgl2StaticBundleTexturePageResource>;
	materialRecords: readonly Webgl2StaticBundleMaterialResource[];
	dispose(): void;
}

export interface Webgl2StructuredInteriorCellResource {
	key: string;
	artifactKey: string;
	landblockId: number;
	envCellId: number;
	geometrySignature: string;
	renderChunkKey: string;
	chunkLocalPlacement: DetailedStructuredInteriorCellArtifact["localPlacement"];
	texturePages: readonly Webgl2StaticBundleTexturePageResource[];
	texturePagesByKey: ReadonlyMap<string, Webgl2StaticBundleTexturePageResource>;
	materialRecords: readonly Webgl2StaticBundleMaterialResource[];
	materialSlices: readonly Webgl2StructuredInteriorMaterialSliceResource[];
	fallbackShell: Webgl2StructuredInteriorShellResource | null;
	triangleCount: number;
	dispose(): void;
}

export interface Webgl2StructuredInteriorShellResource {
	color: RenderVec4;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	indexCount: number;
	triangleCount: number;
	dispose(): void;
}

export interface Webgl2StructuredInteriorMaterialSliceResource {
	key: string;
	cellKey: string;
	envCellId: number;
	materialRecordKey: string;
	materialVariantSignature: string | null;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	normalBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	indexCount: number;
	triangleCount: number;
	dispose(): void;
}

export function createWebgl2StructuredInteriorResourceStore(): Webgl2StructuredInteriorResourceStore {
	return {
		productsByKey: new Map(),
		productResourceKeyByProductKey: new Map(),
		cellKeysByProductKey: new Map(),
		cellsByKey: new Map(),
	};
}

export function commitWebgl2StructuredInteriorProductResources({
	gl,
	store,
	productKey,
	artifact,
	textureFilteringMode = "anisotropic-4x",
	maxAnisotropy = 1,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2StructuredInteriorResourceStore;
	productKey: StaticLandblockProductKey;
	artifact: DetailedLandblockRenderArtifacts;
	textureFilteringMode?: TextureFilteringMode;
	maxAnisotropy?: number;
}): void {
	const productIdentityKey = formatStaticLandblockProductKey(productKey);
	const productResource = createOrReuseStructuredInteriorProductResource({
		gl,
		store,
		artifact,
		textureFilteringMode,
		maxAnisotropy,
	});
	const previousCellKeys =
		store.cellKeysByProductKey.get(productIdentityKey) ?? [];
	const retainedCellKeys = new Set<string>();
	for (const cell of artifact.structuredInteriorCells) {
		const resourceKey = describeStructuredInteriorResourceKey(artifact, cell);
		retainedCellKeys.add(resourceKey);
		const previous = store.cellsByKey.get(resourceKey);
		if (
			previous &&
			previous.geometrySignature ===
				describeStructuredInteriorGeometrySignature(artifact, cell)
		) {
			previous.renderChunkKey = cell.renderChunk.chunkKey;
			previous.chunkLocalPlacement = cell.localPlacement;
			continue;
		}
		previous?.dispose();
		store.cellsByKey.set(
			resourceKey,
			createWebgl2StructuredInteriorCellResource({
				gl,
				artifact,
				cell,
				productResource,
			}),
		);
	}
	for (const cellKey of previousCellKeys) {
		if (!retainedCellKeys.has(cellKey)) {
			store.cellsByKey.get(cellKey)?.dispose();
			store.cellsByKey.delete(cellKey);
		}
	}
	store.productResourceKeyByProductKey.set(
		productIdentityKey,
		productResource.key,
	);
	store.cellKeysByProductKey.set(
		productIdentityKey,
		[...retainedCellKeys].sort(),
	);
}

export function evictWebgl2StructuredInteriorProductResources({
	store,
	productKey,
}: {
	store: Webgl2StructuredInteriorResourceStore;
	productKey: StaticLandblockProductKey;
}): void {
	const productIdentityKey = formatStaticLandblockProductKey(productKey);
	for (const cellKey of store.cellKeysByProductKey.get(productIdentityKey) ??
		[]) {
		store.cellsByKey.get(cellKey)?.dispose();
		store.cellsByKey.delete(cellKey);
	}
	const productResourceKey =
		store.productResourceKeyByProductKey.get(productIdentityKey);
	if (productResourceKey) {
		store.productsByKey.get(productResourceKey)?.dispose();
		store.productsByKey.delete(productResourceKey);
	}
	store.productResourceKeyByProductKey.delete(productIdentityKey);
	store.cellKeysByProductKey.delete(productIdentityKey);
}

export function destroyWebgl2StructuredInteriorResources(
	store: Webgl2StructuredInteriorResourceStore,
): void {
	for (const resource of store.cellsByKey.values()) {
		resource.dispose();
	}
	for (const resource of store.productsByKey.values()) {
		resource.dispose();
	}
	store.cellsByKey.clear();
	store.productsByKey.clear();
	store.productResourceKeyByProductKey.clear();
	store.cellKeysByProductKey.clear();
}

function createOrReuseStructuredInteriorProductResource({
	gl,
	store,
	artifact,
	textureFilteringMode,
	maxAnisotropy,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2StructuredInteriorResourceStore;
	artifact: DetailedLandblockRenderArtifacts;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): Webgl2StructuredInteriorProductResource {
	const key = describeStructuredInteriorProductResourceKey(artifact);
	const resourceSignature =
		describeStructuredInteriorProductResourceSignature(artifact);
	const previous = store.productsByKey.get(key);
	if (previous && previous.resourceSignature === resourceSignature) {
		updateWebgl2StructuredInteriorProductTexturePageSamplerPolicy({
			gl,
			product: previous,
			textureFilteringMode,
			maxAnisotropy,
		});
		return previous;
	}
	if (previous) {
		previous.dispose();
	}
	const product = createWebgl2StructuredInteriorProductResource({
		gl,
		artifact,
		textureFilteringMode,
		maxAnisotropy,
	});
	store.productsByKey.set(key, product);
	return product;
}

function createWebgl2StructuredInteriorProductResource({
	gl,
	artifact,
	textureFilteringMode,
	maxAnisotropy,
}: {
	gl: WebGL2RenderingContext;
	artifact: DetailedLandblockRenderArtifacts;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): Webgl2StructuredInteriorProductResource {
	const texturePages = artifact.structuredInteriorTexturePages.map((page) =>
		createWebgl2StaticBundleTexturePageResource({
			gl,
			page,
			textureFilteringMode,
			maxAnisotropy,
		}),
	);
	const texturePagesByKey = new Map(
		texturePages.map((page) => [page.key, page]),
	);
	const texturePageByVirtualRefKey =
		createStaticBundleTexturePageByVirtualRefKey(texturePages);
	const textureRefByVirtualRefKey = createStaticBundleTextureRefByKey(
		artifact.structuredInteriorTexturePageRefs,
	);
	const materialRecords = artifact.structuredInteriorMaterialRecords.map(
		(record) =>
			createWebgl2StaticBundleMaterialResource({
				record,
				textureRefByVirtualRefKey,
				texturePageByVirtualRefKey,
			}),
	);
	return {
		key: describeStructuredInteriorProductResourceKey(artifact),
		artifactKey: artifact.key,
		resourceSignature:
			describeStructuredInteriorProductResourceSignature(artifact),
		texturePages,
		texturePagesByKey,
		materialRecords,
		dispose() {
			for (const page of texturePages) {
				page.texture.dispose();
			}
		},
	};
}

function createWebgl2StructuredInteriorCellResource({
	gl,
	artifact,
	cell,
	productResource,
}: {
	gl: WebGL2RenderingContext;
	artifact: DetailedLandblockRenderArtifacts;
	cell: DetailedStructuredInteriorCellArtifact;
	productResource: Webgl2StructuredInteriorProductResource;
}): Webgl2StructuredInteriorCellResource {
	const materialSlices = cell.materialSlices.map((slice) =>
		createWebgl2StructuredInteriorMaterialSliceResource({ gl, slice }),
	);
	const fallbackShell =
		materialSlices.length === 0
			? createWebgl2StructuredInteriorShellResource({ gl, cell })
			: null;
	const triangleCount =
		materialSlices.length > 0
			? materialSlices.reduce((total, slice) => total + slice.triangleCount, 0)
			: (fallbackShell?.triangleCount ?? 0);
	return {
		key: describeStructuredInteriorResourceKey(artifact, cell),
		artifactKey: artifact.key,
		landblockId: cell.landblockId,
		envCellId: cell.envCellId,
		geometrySignature: describeStructuredInteriorGeometrySignature(
			artifact,
			cell,
		),
		renderChunkKey: cell.renderChunk.chunkKey,
		chunkLocalPlacement: cell.localPlacement,
		texturePages: productResource.texturePages,
		texturePagesByKey: productResource.texturePagesByKey,
		materialRecords: productResource.materialRecords,
		materialSlices,
		fallbackShell,
		triangleCount,
		dispose() {
			for (const slice of materialSlices) {
				slice.dispose();
			}
			fallbackShell?.dispose();
		},
	};
}

function updateWebgl2StructuredInteriorProductTexturePageSamplerPolicy({
	gl,
	product,
	textureFilteringMode,
	maxAnisotropy,
}: {
	gl: WebGL2RenderingContext;
	product: Webgl2StructuredInteriorProductResource;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): void {
	for (const page of product.texturePages) {
		updateWebgl2StaticBundleTexturePageResourceSamplerPolicy({
			gl,
			page,
			textureFilteringMode,
			maxAnisotropy,
		});
	}
}

function createWebgl2StructuredInteriorShellResource({
	gl,
	cell,
}: {
	gl: WebGL2RenderingContext;
	cell: DetailedStructuredInteriorCellArtifact;
}): Webgl2StructuredInteriorShellResource {
	const geometry = buildPolygonSetRenderGeometry(cell.renderGeometry, {
		sourceSignature: cell.key,
	});
	const positionBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${cell.key}/positions`,
		data: geometry.positions,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${cell.key}/indices`,
		data: geometry.indices,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${cell.key}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		color: createStructuredInteriorCellColor(cell),
		vertexArray,
		positionBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		indexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		dispose() {
			vertexArray.dispose();
			positionBuffer.dispose();
			indexBuffer.dispose();
		},
	};
}

function createWebgl2StructuredInteriorMaterialSliceResource({
	gl,
	slice,
}: {
	gl: WebGL2RenderingContext;
	slice: DetailedStructuredInteriorMaterialSlice;
}): Webgl2StructuredInteriorMaterialSliceResource {
	const positionBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${slice.key}/positions`,
		data: toFloat32Array(slice.positions),
	});
	const uvBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${slice.key}/uvs`,
		data: toFloat32Array(slice.uvs),
	});
	const normalBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${slice.key}/normals`,
		data: toFloat32Array(slice.normals),
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${slice.key}/indices`,
		data: slice.indices,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${slice.key}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer.buffer);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer.buffer);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		key: slice.key,
		cellKey: slice.cellKey,
		envCellId: slice.envCellId,
		materialRecordKey: slice.materialRecordKey,
		materialVariantSignature: slice.materialVariantSignature,
		vertexArray,
		positionBuffer,
		normalBuffer,
		uvBuffer,
		indexBuffer,
		indexType:
			slice.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		indexCount: slice.indices.length,
		triangleCount: slice.triangleCount,
		dispose() {
			vertexArray.dispose();
			positionBuffer.dispose();
			normalBuffer.dispose();
			uvBuffer.dispose();
			indexBuffer.dispose();
		},
	};
}

function describeStructuredInteriorResourceKey(
	artifact: DetailedLandblockRenderArtifacts,
	cell: DetailedStructuredInteriorCellArtifact,
): string {
	return [
		"structured-interior",
		artifact.product,
		artifact.landblockId,
		cell.envCellId,
		artifact.buildPolicyRevision,
		artifact.texturePagePolicyRevision,
	].join(":");
}

function describeStructuredInteriorProductResourceKey(
	artifact: DetailedLandblockRenderArtifacts,
): string {
	return [
		"structured-interior-product",
		artifact.product,
		artifact.landblockId,
		artifact.buildPolicyRevision,
		artifact.texturePagePolicyRevision,
	].join(":");
}

function describeStructuredInteriorProductResourceSignature(
	artifact: DetailedLandblockRenderArtifacts,
): string {
	return [
		artifact.key,
		artifact.structuredInteriorTexturePages
			.map(describeTexturePageKey)
			.join(","),
		artifact.structuredInteriorTexturePageRefs.map((ref) => ref.key).join(","),
		artifact.structuredInteriorMaterialRecords
			.map((record) => record.key)
			.join(","),
	].join(":");
}

function describeStructuredInteriorGeometrySignature(
	artifact: DetailedLandblockRenderArtifacts,
	cell: DetailedStructuredInteriorCellArtifact,
): string {
	return [
		artifact.key,
		cell.key,
		cell.renderGeometry.sourceId,
		cell.renderGeometry.vertexCount,
		cell.renderGeometry.triangleCount,
		cell.renderGeometry.skippedPolygonCount ?? 0,
		cell.materialSlices.length,
	].join(":");
}

function createStructuredInteriorCellColor(
	cell: DetailedStructuredInteriorCellArtifact,
): RenderVec4 {
	const hue = (cell.envCellId & 0xff) / 255;
	return new Float32Array([0.45 + hue * 0.25, 0.58, 0.72 - hue * 0.2, 1]);
}

function describeTexturePageKey(page: StaticBundleTexturePage): string {
	return page.key;
}

function toFloat32Array(
	values: Float32Array | readonly number[],
): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}
