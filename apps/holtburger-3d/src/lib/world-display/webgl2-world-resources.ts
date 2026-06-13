import type { PreparedTexturePayload } from "../assets/types";
import { profileBrowserJsScope } from "../diagnostics/browser-js-profiler";
import { resolveNormalizedPreparedTextureAssetIds } from "../assets/material-texture-preparation-policy";
import { formatHex32 } from "../landblocks";
import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2Texture2DResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import type { RenderIndexedGeometry } from "./indexed-render-geometry";
import type { IndexedMaterialDataCache } from "./indexed-material-data";
import {
	resolveRegionDetailOverlayPlan,
	type ResolvedRegionDetailOverlayPlan,
} from "./region-detail-overlays";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import {
	formatStaticLandblockProductKey,
	getLandblockTerrainRenderArtifact,
	type StaticLandblockProductKey,
	type LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import type {
	MaterialTextureCapabilities,
	RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import { prepareRenderSurfaceTextureUploadData } from "./render-surface-texture-data";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";
import {
	buildTransitionPortalMaskResourceAssemblies,
	type TransitionPortalMaskResourceAssembly,
} from "./transition-portal-mask-resources";
import {
	createDefaultMaterialTextureSamplingPolicy,
	selectRenderSurfaceTextureSamplingPolicy,
	type TextureFilteringMode,
} from "./texture-pages/texture-sampling-policy";
import { type RenderMaterialTexturePageReadiness } from "./render-material-strategy";
import {
	planCompactionFamilies,
	type CompactionFamilyPlanningPolicy,
} from "./compaction/compaction-family-planner";
import {
	createEmptyTexturePageAtlasPlan,
	createTexturePageDetailAtlasPlacementsByEntryKey,
	createTexturePageAtlasPlacementsByEntryKey,
	type TexturePageAtlasCohort,
	type TexturePageAtlasDetailCandidate,
	type TexturePageAtlasRgbaCandidate,
	type TexturePageAtlasPlan,
} from "./texture-pages/texture-page-atlas-planner";
import { isTerrainTexturePageBucket } from "./texture-pages/texture-page-binding";
import {
	createTexturePageCpuSet,
	createWebgl2TexturePageTextureResourceFromCpu,
	describeWebgl2TexturePageSetKey,
	type TexturePageCpuSet,
} from "./webgl2/resources/texture-page-upload";
import { type TerrainBlendTextureRef } from "./terrain-blend-plan";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";
import type {
	LandblockTerrainRenderArtifact,
	TerrainRenderDrawSliceArtifact,
	TerrainRenderTexturePageRef,
} from "./terrain-render-artifact";
import {
	buildTerrainTileLayerGeometry,
	type TerrainTileDrawSlicePlan,
	type TerrainTileLayerEntry,
	type TerrainTileLayerGeometry,
	type TerrainTileLayerPlan,
} from "./terrain-tile-plan";
import {
	createBlockedTerrainTileOneDrawReadiness,
	describeTerrainBlendTextureAtlasEntryKey,
	describeTerrainTileGeometrySignature,
	deriveTerrainTileRenderCandidate,
	deriveTerrainTileOneDrawReadiness,
	deriveTerrainDrawSliceOneDrawReadiness,
	destroyWebgl2TerrainTileDrawSlice,
	destroyWebgl2TerrainTileResource,
	terrainTileResourceId,
	type Webgl2TerrainTileTexturePageBinding,
	type Webgl2TerrainTexturePageResource,
	type Webgl2TerrainTileDetailPlan,
	type Webgl2TerrainTileDrawSliceResource,
	type Webgl2TerrainTileRenderCandidate,
	type Webgl2TerrainTileResource,
	type Webgl2TerrainTileReadiness,
} from "./webgl2/resources/terrain-tile-resources";
import {
	createWebgl2StaticBundleLayerResourceStore,
	destroyWebgl2StaticBundleLayerResources,
	type Webgl2StaticBundleLayerResourceStore,
} from "./webgl2/resources/static-bundle-layer-resources";
import {
	createWebgl2StructuredInteriorResourceStore,
	destroyWebgl2StructuredInteriorResources,
	type Webgl2StructuredInteriorResourceStore,
} from "./webgl2/resources/structured-interior-resources";

export interface Webgl2TransitionPortalMaskResource {
	id: string;
	kind: "transition-portal-mask";
	candidateId: string;
	geometrySignature: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	renderChunkKey: string;
	chunkLocalPlacement: TransitionPortalMaskResourceAssembly["chunkLocalPlacement"];
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
	portalCandidate: TransitionPortalMaskResourceAssembly["portalCandidate"];
}

export interface Webgl2WorldResourceStore {
	transitionPortalMasks: Webgl2TransitionPortalMaskResource[];
	transitionPortalMasksById: Map<string, Webgl2TransitionPortalMaskResource>;
	terrainTiles: Webgl2TerrainTileResource[];
	terrainTilesById: Map<string, Webgl2TerrainTileResource>;
	terrainTileIdsByProductKey: Map<string, readonly string[]>;
	terrainRenderCandidates: Webgl2TerrainTileRenderCandidate[];
	staticBundleLayerResources: Webgl2StaticBundleLayerResourceStore;
	structuredInteriorResources: Webgl2StructuredInteriorResourceStore;
	staticBundleLayerResourceCount: number;
	structuredInteriorResourceCount: number;
	structuredInteriorProductResourceCount: number;
	structuredInteriorTexturePageResourceCount: number;
	structuredInteriorMaterialRecordResourceCount: number;
	structuredInteriorResourceTriangleCount: number;
	staticBundleLayerCompactedBatchResourceCount: number;
	staticBundleLayerDirectEntryResourceCount: number;
	staticBundleLayerTexturePageResourceCount: number;
	terrainTileCount: number;
	materialCount: number;
	materialFallbackReasonCount: number;
	materialFallbackReasonSamples: readonly string[];
	textureSamplingPolicyCounts: Record<string, number>;
	texturePageBindingCount: number;
	texturePageUsageBucketCounts: Record<string, number>;
	texturePageSampleClassCounts: Record<string, number>;
	texturePageReadyMaterialCount: number;
	atlasCandidateEntryCount: number;
	atlasCandidateMaterialSlotCount: number;
	terrainAtlasRefCount: number;
	terrainAtlasCandidateCount: number;
	terrainAtlasBlockerTileCount: number;
	atlasFailureReasonCount: number;
	atlasFailureSamples: readonly string[];
	texturePageAtlasPlan: TexturePageAtlasPlan;
	productTerrainTexturePagesByKey: Map<
		string,
		Webgl2TerrainTexturePageResource
	>;
	productTerrainTexturePagesByBucketIndex: Map<
		string,
		Webgl2TerrainTexturePageResource
	>;
	terrainTexturePageCount: number;
	terrainDetailTexturePageCount: number;
	textureCount: number;
	indexedTextureCount: number;
	paletteTextureCount: number;
	detailTextureCount: number;
	preparedTextureUploadCount: number;
	preparedTextureGeneratedByteLength: number;
	triangleCount: number;
	texturesByKey: Map<string, Webgl2Texture2DResource>;
	indexedMaterialDataCache: IndexedMaterialDataCache;
}

export function createWebgl2WorldResourceStore(): Webgl2WorldResourceStore {
	return {
		transitionPortalMasks: [],
		transitionPortalMasksById: new Map(),
		terrainTiles: [],
		terrainTilesById: new Map(),
		terrainTileIdsByProductKey: new Map(),
		terrainRenderCandidates: [],
		staticBundleLayerResources: createWebgl2StaticBundleLayerResourceStore(),
		structuredInteriorResources: createWebgl2StructuredInteriorResourceStore(),
		staticBundleLayerResourceCount: 0,
		structuredInteriorResourceCount: 0,
		structuredInteriorProductResourceCount: 0,
		structuredInteriorTexturePageResourceCount: 0,
		structuredInteriorMaterialRecordResourceCount: 0,
		structuredInteriorResourceTriangleCount: 0,
		staticBundleLayerCompactedBatchResourceCount: 0,
		staticBundleLayerDirectEntryResourceCount: 0,
		staticBundleLayerTexturePageResourceCount: 0,
		terrainTileCount: 0,
		materialCount: 0,
		materialFallbackReasonCount: 0,
		materialFallbackReasonSamples: [],
		textureSamplingPolicyCounts: {},
		texturePageBindingCount: 0,
		texturePageUsageBucketCounts: {},
		texturePageSampleClassCounts: {},
		texturePageReadyMaterialCount: 0,
		atlasCandidateEntryCount: 0,
		atlasCandidateMaterialSlotCount: 0,
		terrainAtlasRefCount: 0,
		terrainAtlasCandidateCount: 0,
		terrainAtlasBlockerTileCount: 0,
		atlasFailureReasonCount: 0,
		atlasFailureSamples: [],
		texturePageAtlasPlan: createEmptyTexturePageAtlasPlan(),
		productTerrainTexturePagesByKey: new Map(),
		productTerrainTexturePagesByBucketIndex: new Map(),
		terrainTexturePageCount: 0,
		terrainDetailTexturePageCount: 0,
		textureCount: 0,
		indexedTextureCount: 0,
		paletteTextureCount: 0,
		detailTextureCount: 0,
		preparedTextureUploadCount: 0,
		preparedTextureGeneratedByteLength: 0,
		triangleCount: 0,
		texturesByKey: new Map(),
		indexedMaterialDataCache: new Map(),
	};
}

export function refreshWebgl2StaticLandblockProductResourceCounters(
	store: Webgl2WorldResourceStore,
): void {
	const resources = [...store.staticBundleLayerResources.layersByKey.values()];
	store.staticBundleLayerResourceCount = resources.length;
	const structuredInteriorResources = [
		...store.structuredInteriorResources.cellsByKey.values(),
	];
	const structuredInteriorProductResources = [
		...store.structuredInteriorResources.productsByKey.values(),
	];
	store.structuredInteriorResourceCount = structuredInteriorResources.length;
	store.structuredInteriorProductResourceCount =
		structuredInteriorProductResources.length;
	store.structuredInteriorTexturePageResourceCount =
		structuredInteriorProductResources.reduce(
			(total, resource) => total + resource.texturePages.length,
			0,
		);
	store.structuredInteriorMaterialRecordResourceCount =
		structuredInteriorProductResources.reduce(
			(total, resource) => total + resource.materialRecords.length,
			0,
		);
	store.structuredInteriorResourceTriangleCount =
		structuredInteriorResources.reduce(
			(total, resource) => total + resource.triangleCount,
			0,
		);
	store.staticBundleLayerCompactedBatchResourceCount = resources.reduce(
		(total, resource) => total + resource.compactedBatches.length,
		0,
	);
	store.staticBundleLayerDirectEntryResourceCount = resources.reduce(
		(total, resource) => total + resource.directEntries.length,
		0,
	);
	store.staticBundleLayerTexturePageResourceCount = resources.reduce(
		(total, resource) => total + resource.texturePages.length,
		0,
	);
}

export function commitWebgl2TerrainProductResources({
	gl,
	store,
	productKey,
	artifact,
	assetReadModel,
	materialTextureCapabilities = defaultWebgl2MaterialTextureCapabilities(),
	textureFilteringMode = "anisotropic-4x",
	detailTexturesEnabled = true,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	productKey: StaticLandblockProductKey;
	artifact: LandblockTerrainRenderArtifact;
	assetReadModel: RendererAssetReadModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
}): void {
	const productIdentityKey = formatStaticLandblockProductKey(productKey);
	const tile = createOrReuseWebgl2TerrainTileFromArtifact({
		gl,
		store,
		artifact,
	});
	const previousTileIds =
		store.terrainTileIdsByProductKey.get(productIdentityKey) ?? [];
	const retainedTileIds = new Set(tile ? [tile.id] : []);
	for (const tileId of previousTileIds) {
		if (!retainedTileIds.has(tileId)) {
			destroyWebgl2TerrainTileResourceById({ store, tileId });
		}
	}
	store.terrainTileIdsByProductKey.set(
		productIdentityKey,
		[...retainedTileIds].sort(),
	);
	refreshWebgl2TerrainProductDerivedState({
		gl,
		store,
		assetReadModel,
		materialTextureCapabilities,
		textureFilteringMode,
		detailTexturesEnabled,
	});
}

export function commitWebgl2TerrainProductResultResources({
	gl,
	store,
	result,
	assetReadModel,
	materialTextureCapabilities,
	textureFilteringMode,
	detailTexturesEnabled,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	result: LandblockRenderProductWorkerResult;
	assetReadModel: RendererAssetReadModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
}): void {
	const artifact = getLandblockTerrainRenderArtifact(result);
	if (!artifact) {
		return;
	}
	commitWebgl2TerrainProductResources({
		gl,
		store,
		productKey: {
			landblockId: result.landblockId,
			product: result.product,
			buildPolicyRevision: result.buildPolicyRevision,
			texturePagePolicyRevision: result.texturePagePolicyRevision,
		},
		artifact,
		assetReadModel,
		materialTextureCapabilities,
		textureFilteringMode,
		detailTexturesEnabled,
	});
}

export function evictWebgl2TerrainProductResources({
	gl,
	store,
	productKey,
	assetReadModel,
	materialTextureCapabilities = defaultWebgl2MaterialTextureCapabilities(),
	textureFilteringMode = "anisotropic-4x",
	detailTexturesEnabled = true,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	productKey: StaticLandblockProductKey;
	assetReadModel: RendererAssetReadModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
}): void {
	const productIdentityKey = formatStaticLandblockProductKey(productKey);
	for (const tileId of store.terrainTileIdsByProductKey.get(
		productIdentityKey,
	) ?? []) {
		destroyWebgl2TerrainTileResourceById({ store, tileId });
	}
	store.terrainTileIdsByProductKey.delete(productIdentityKey);
	refreshWebgl2TerrainProductDerivedState({
		gl,
		store,
		assetReadModel,
		materialTextureCapabilities,
		textureFilteringMode,
		detailTexturesEnabled,
	});
}

export function updateWebgl2TerrainProductSamplerPolicy({
	gl,
	store,
	assetReadModel,
	materialTextureCapabilities = defaultWebgl2MaterialTextureCapabilities(),
	textureFilteringMode,
	detailTexturesEnabled = true,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	assetReadModel: RendererAssetReadModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
}): void {
	refreshWebgl2TerrainProductDerivedState({
		gl,
		store,
		assetReadModel,
		materialTextureCapabilities,
		textureFilteringMode,
		detailTexturesEnabled,
	});
}

export function syncWebgl2TransitionPortalMaskResources({
	gl,
	store,
	transitionPortalModel,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	transitionPortalModel: TransitionPortalCandidateModel;
}): void {
	const assemblies = buildTransitionPortalMaskResourceAssemblies({
		transitionPortalModel,
	});
	for (const mask of store.transitionPortalMasksById.values()) {
		destroyWebgl2TransitionPortalMaskResource(mask);
	}
	store.transitionPortalMasksById.clear();
	for (const assembly of assemblies) {
		createWebgl2TransitionPortalMaskResource({
			gl,
			store,
			assembly,
		});
	}
	refreshWebgl2TransitionPortalMaskResources(store);
}

export function clearWebgl2TransitionPortalMaskResources({
	store,
}: {
	store: Webgl2WorldResourceStore;
}): void {
	for (const mask of store.transitionPortalMasksById.values()) {
		destroyWebgl2TransitionPortalMaskResource(mask);
	}
	store.transitionPortalMasksById.clear();
	refreshWebgl2TransitionPortalMaskResources(store);
}

function refreshWebgl2TransitionPortalMaskResources(
	store: Webgl2WorldResourceStore,
): void {
	store.transitionPortalMasks = [
		...store.transitionPortalMasksById.values(),
	].sort((left, right) => left.id.localeCompare(right.id));
}

function refreshWebgl2TerrainProductDerivedState({
	gl,
	store,
	assetReadModel,
	materialTextureCapabilities,
	textureFilteringMode,
	detailTexturesEnabled,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	assetReadModel: RendererAssetReadModel;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	detailTexturesEnabled: boolean;
}): void {
	store.terrainTiles = [...store.terrainTilesById.values()].sort(
		(left, right) => left.id.localeCompare(right.id),
	);
	store.terrainRenderCandidates = store.terrainTiles.map(
		deriveTerrainTileRenderCandidate,
	);
	store.terrainTileCount = store.terrainTiles.length;
	store.materialFallbackReasonCount = 0;
	store.materialFallbackReasonSamples = [];
	const productTerrainTiles = selectProductOwnedTerrainTiles(store);
	const terrainPageCandidates = collectTerrainTexturePageAtlasCandidates({
		assetReadModel,
		terrainTiles: productTerrainTiles,
		materialTextureCapabilities,
		textureFilteringMode,
		detailTexturesEnabled,
		reportDiagnostic: (message) => {
			recordMaterialFallbackReason(store, message);
		},
	});
	store.terrainAtlasRefCount = terrainPageCandidates.refCount;
	store.terrainAtlasCandidateCount =
		terrainPageCandidates.rgbaCandidates.length;
	store.terrainAtlasBlockerTileCount =
		terrainPageCandidates.blockersByTerrainTileId.size;
	applyTerrainTexturePageBlockers({
		terrainTiles: productTerrainTiles,
		blockersByTerrainTileId: terrainPageCandidates.blockersByTerrainTileId,
	});
	const productTerrainTexturePageAtlasPlan = planCompactionFamilies({
		candidates: [],
		policy: DEFAULT_WEBGL2_COMPACTION_FAMILY_PLANNING_POLICY,
		extraRgbaAtlasCandidates: terrainPageCandidates.rgbaCandidates,
		extraDetailAtlasCandidates: terrainPageCandidates.detailCandidates,
		extraTexturePageAtlasCohorts: terrainPageCandidates.cohorts,
	}).texturePageAtlasPlan;
	syncWebgl2TerrainTexturePageResources({
		gl,
		texturePagesByKey: store.productTerrainTexturePagesByKey,
		texturePagesByBucketIndex: store.productTerrainTexturePagesByBucketIndex,
		plan: productTerrainTexturePageAtlasPlan,
		textureFilteringMode,
		maxAnisotropy: materialTextureCapabilities.maxAnisotropy ?? 1,
	});
	resolveWebgl2TerrainTileTexturePageBindings({
		gl,
		store,
		terrainTiles: productTerrainTiles,
		plan: productTerrainTexturePageAtlasPlan,
		texturePagesByBucketIndex: store.productTerrainTexturePagesByBucketIndex,
	});
	refreshWebgl2TerrainTexturePageCounters(store);
}

function recordMaterialFallbackReason(
	store: Webgl2WorldResourceStore,
	message: string,
): void {
	store.materialFallbackReasonCount += 1;
	store.materialFallbackReasonSamples = [
		...store.materialFallbackReasonSamples,
		message,
	].slice(0, 8);
}

function destroyWebgl2TerrainTileResourceById({
	store,
	tileId,
}: {
	store: Webgl2WorldResourceStore;
	tileId: string;
}): void {
	const tile = store.terrainTilesById.get(tileId);
	if (!tile) {
		return;
	}
	destroyWebgl2TerrainTileResource(tile);
	store.terrainTilesById.delete(tileId);
}

function createWebgl2TransitionPortalMaskResource({
	gl,
	store,
	assembly,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	assembly: TransitionPortalMaskResourceAssembly;
}): Webgl2TransitionPortalMaskResource {
	const geometrySignature =
		createTransitionPortalMaskGeometrySignature(assembly);
	const vertexBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${assembly.id}/positions`,
		data: assembly.geometry.positions,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${assembly.id}/indices`,
		data: assembly.geometry.indices,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${assembly.id}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	const resource = {
		id: assembly.id,
		kind: "transition-portal-mask",
		candidateId: assembly.portalCandidate.id,
		geometrySignature,
		vertexArray,
		vertexBuffer,
		indexBuffer,
		indexType:
			assembly.geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		vertexCount: assembly.geometry.indices.length,
		triangleCount: assembly.geometry.triangleCount,
		renderChunkKey: assembly.renderChunkKey,
		chunkLocalPlacement: assembly.chunkLocalPlacement,
		bvhItemKeys: assembly.bvhBinding.itemKeys,
		bvhFallbackReason: assembly.bvhBinding.fallbackReason,
		portalCandidate: assembly.portalCandidate,
	} satisfies Webgl2TransitionPortalMaskResource;
	store.transitionPortalMasksById.set(resource.id, resource);
	return resource;
}

function destroyWebgl2TransitionPortalMaskResource(
	mask: Webgl2TransitionPortalMaskResource,
): void {
	mask.vertexArray.dispose();
	mask.vertexBuffer.dispose();
	mask.indexBuffer.dispose();
}

function selectProductOwnedTerrainTiles(
	store: Webgl2WorldResourceStore,
): Webgl2TerrainTileResource[] {
	const productOwnedTerrainTileIds = new Set(
		[...store.terrainTileIdsByProductKey.values()].flatMap((tileIds) => [
			...tileIds,
		]),
	);
	return [...productOwnedTerrainTileIds]
		.flatMap((tileId) => store.terrainTilesById.get(tileId) ?? [])
		.sort((left, right) => left.id.localeCompare(right.id));
}

function refreshWebgl2TerrainTexturePageCounters(
	store: Webgl2WorldResourceStore,
): void {
	const texturePages = [...store.productTerrainTexturePagesByKey.values()];
	store.terrainTexturePageCount = texturePages.length;
	store.terrainDetailTexturePageCount = texturePages.filter(
		(texturePage) => texturePage.bucket === "terrain-detail",
	).length;
}

export function destroyWebgl2WorldResources(
	store: Webgl2WorldResourceStore,
): void {
	for (const mask of store.transitionPortalMasksById.values()) {
		destroyWebgl2TransitionPortalMaskResource(mask);
	}
	for (const terrainTile of store.terrainTiles) {
		destroyWebgl2TerrainTileResource(terrainTile);
	}
	destroyWebgl2StaticBundleLayerResources(store.staticBundleLayerResources);
	destroyWebgl2StructuredInteriorResources(store.structuredInteriorResources);
	store.transitionPortalMasks = [];
	store.transitionPortalMasksById.clear();
	store.terrainTiles = [];
	store.terrainTilesById.clear();
	store.terrainTileIdsByProductKey.clear();
	store.terrainRenderCandidates = [];
	store.staticBundleLayerResourceCount = 0;
	store.structuredInteriorResourceCount = 0;
	store.structuredInteriorProductResourceCount = 0;
	store.structuredInteriorTexturePageResourceCount = 0;
	store.structuredInteriorMaterialRecordResourceCount = 0;
	store.structuredInteriorResourceTriangleCount = 0;
	store.staticBundleLayerCompactedBatchResourceCount = 0;
	store.staticBundleLayerDirectEntryResourceCount = 0;
	store.staticBundleLayerTexturePageResourceCount = 0;
	store.terrainTileCount = 0;
	store.materialCount = 0;
	store.materialFallbackReasonCount = 0;
	store.materialFallbackReasonSamples = [];
	store.textureSamplingPolicyCounts = {};
	store.texturePageBindingCount = 0;
	store.texturePageUsageBucketCounts = {};
	store.texturePageSampleClassCounts = {};
	store.texturePageReadyMaterialCount = 0;
	store.atlasCandidateEntryCount = 0;
	store.atlasCandidateMaterialSlotCount = 0;
	store.atlasFailureReasonCount = 0;
	store.atlasFailureSamples = [];
	store.texturePageAtlasPlan = createEmptyTexturePageAtlasPlan();
	for (const terrainTexturePage of store.productTerrainTexturePagesByKey.values()) {
		terrainTexturePage.texture.dispose();
	}
	store.productTerrainTexturePagesByKey.clear();
	store.productTerrainTexturePagesByBucketIndex.clear();
	store.terrainTexturePageCount = 0;
	store.terrainDetailTexturePageCount = 0;
	for (const texture of store.texturesByKey.values()) {
		texture.dispose();
	}
	store.texturesByKey.clear();
	store.indexedMaterialDataCache.clear();
	store.textureCount = 0;
	store.indexedTextureCount = 0;
	store.paletteTextureCount = 0;
	store.detailTextureCount = 0;
	store.preparedTextureUploadCount = 0;
	store.preparedTextureGeneratedByteLength = 0;
	store.triangleCount = 0;
}

const DEFAULT_WEBGL2_COMPACTION_FAMILY_PLANNING_POLICY: CompactionFamilyPlanningPolicy =
	{
		maxAtlasTextureSize: 4096,
		maxAtlasTextureCount: 8,
		baseGutterPixels: 2,
		maxMaterialSlotsPerDraw: 128,
	};

function createOrReuseWebgl2TerrainTileFromArtifact({
	gl,
	store,
	artifact,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	artifact: LandblockTerrainRenderArtifact;
}): Webgl2TerrainTileResource | null {
	const placement = deriveLandblockRenderChunkPlacement(artifact.landblockId);
	const id = terrainTileResourceId({ assetId: artifact.key });
	const uploadPlan = createTerrainArtifactResourceUploadPlan({
		id,
		artifact,
	});
	if (uploadPlan.geometry.triangleCount === 0) {
		return null;
	}
	const geometrySignature = describeTerrainTileGeometrySignature(
		uploadPlan.geometry,
	);
	const previous = store.terrainTilesById.get(id);
	if (
		previous &&
		previous.geometrySignature === geometrySignature &&
		describeTerrainTileReadinessSignature(previous.readiness) ===
			describeTerrainTileReadinessSignature(uploadPlan.readiness)
	) {
		previous.label = formatHex32(artifact.landblockId);
		previous.regionNumber = artifact.regionNumber;
		previous.renderChunkKey = placement.chunkKey;
		previous.readiness = uploadPlan.readiness;
		previous.dataSource = "worker-landblock-render-artifact";
		previous.mesh = artifact.mesh;
		previous.bvhItemKeys = [...artifact.bvhItemKeys];
		previous.bvhFallbackReason =
			artifact.bvhItemKeys.length === 0
				? `terrain artifact ${artifact.key} contains no terrain quad keys`
				: null;
		previous.drawSlices = createOrReuseWebgl2TerrainTileDrawSlices({
			gl,
			parentTerrainTileId: id,
			renderChunkKey: placement.chunkKey,
			plans: uploadPlan.drawSlicePlans,
			previousSlices: previous.drawSlices,
		});
		previous.layerPlan = uploadPlan.layerPlan;
		previous.layerPlanBlockers = uploadPlan.layerPlanBlockers;
		previous.terrainArtifactTexturePageRefs =
			uploadPlan.terrainArtifactTexturePageRefs;
		previous.detailPlan = null;
		previous.texturePageBindings = [];
		previous.texturePageBlockers = [];
		previous.oneDrawReadiness = createBlockedTerrainTileOneDrawReadiness([
			"terrain texture page bindings are unresolved",
		]);
		return previous;
	}
	if (previous) {
		destroyWebgl2TerrainTileResource(previous);
	}
	const buffers = createWebgl2IndexedGeometryBuffers(gl, {
		id,
		geometry: uploadPlan.geometry,
	});
	const drawSlices = createOrReuseWebgl2TerrainTileDrawSlices({
		gl,
		parentTerrainTileId: id,
		renderChunkKey: placement.chunkKey,
		plans: uploadPlan.drawSlicePlans,
		previousSlices: [],
	});
	const resource = {
		id,
		assetId: artifact.key,
		landblockId: artifact.landblockId,
		regionNumber: artifact.regionNumber,
		label: formatHex32(artifact.landblockId),
		renderChunkKey: placement.chunkKey,
		geometrySignature,
		...buffers,
		vertexCount: uploadPlan.geometry.indices.length,
		triangleCount: uploadPlan.geometry.triangleCount,
		readiness: uploadPlan.readiness,
		dataSource: "worker-landblock-render-artifact",
		mesh: artifact.mesh,
		bvhItemKeys: [...artifact.bvhItemKeys],
		bvhFallbackReason:
			artifact.bvhItemKeys.length === 0
				? `terrain artifact ${artifact.key} contains no terrain quad keys`
				: null,
		drawSlices,
		layerPlan: uploadPlan.layerPlan,
		layerPlanBlockers: uploadPlan.layerPlanBlockers,
		terrainArtifactTexturePageRefs: uploadPlan.terrainArtifactTexturePageRefs,
		detailPlan: null,
		texturePageBindings: [],
		texturePageBlockers: [],
		oneDrawReadiness: createBlockedTerrainTileOneDrawReadiness([
			"terrain texture page bindings are unresolved",
		]),
	} satisfies Webgl2TerrainTileResource;
	store.terrainTilesById.set(id, resource);
	return resource;
}

function createTerrainArtifactResourceUploadPlan({
	id,
	artifact,
	readiness = deriveWebgl2TerrainArtifactReadiness(artifact),
}: {
	id: string;
	artifact: LandblockTerrainRenderArtifact;
	readiness?: Webgl2TerrainTileReadiness;
}): {
	readiness: Webgl2TerrainTileReadiness;
	geometry: RenderIndexedGeometry | TerrainTileLayerGeometry;
	layerPlan: TerrainTileLayerPlan | null;
	layerPlanBlockers: readonly string[];
	drawSlicePlans: readonly TerrainTileDrawSliceUploadPlan[];
	terrainArtifactTexturePageRefs: readonly TerrainRenderTexturePageRef[];
} {
	const oneDrawSlice =
		artifact.drawSlices.length === 1 &&
		artifact.drawSlices[0]?.slicePlan.layerPlan.blockers.length === 0
			? artifact.drawSlices[0]
			: null;
	const drawSlicePlans = oneDrawSlice
		? []
		: artifact.drawSlices.flatMap((slice) =>
				createTerrainDrawSliceUploadPlansFromArtifact({
					id: `${id}/${slice.slicePlan.id}`,
					mesh: artifact.mesh,
					slice,
				}),
			);
	const fallbackBlockers =
		artifact.diagnostics.fallbackReasons.length > 0
			? artifact.diagnostics.fallbackReasons
			: ["terrain artifact did not emit a one-draw layer plan"];
	return {
		readiness,
		geometry: oneDrawSlice?.geometry ?? artifact.debugFallbackGeometry,
		layerPlan: oneDrawSlice?.slicePlan.layerPlan ?? artifact.layerPlan,
		layerPlanBlockers:
			oneDrawSlice?.slicePlan.layerPlan.blockers ??
			artifact.layerPlan?.blockers ??
			fallbackBlockers,
		drawSlicePlans,
		terrainArtifactTexturePageRefs: artifact.texturePageRefs,
	};
}

interface TerrainTileDrawSliceUploadPlan {
	id: string;
	reason: string;
	geometrySignature: string;
	geometry: TerrainTileLayerGeometry;
	vertexCount: number;
	triangleCount: number;
	bvhItemKeys: RenderBvhItemKey[];
	layerPlan: TerrainTileLayerPlan;
}

function createTerrainDrawSliceUploadPlans({
	id,
	mesh,
	reason,
	slicePlan,
}: {
	id: string;
	mesh: LandblockTerrainRenderArtifact["mesh"];
	reason: string;
	slicePlan: TerrainTileDrawSlicePlan;
}): TerrainTileDrawSliceUploadPlan[] {
	const geometry = buildTerrainTileLayerGeometry({
		mesh,
		plan: slicePlan.layerPlan,
	});
	if (geometry.triangleCount === 0) {
		return [];
	}
	return [
		{
			id,
			reason,
			geometrySignature: describeTerrainTileGeometrySignature(geometry),
			geometry,
			vertexCount: geometry.indices.length,
			triangleCount: geometry.triangleCount,
			bvhItemKeys: deriveTerrainDrawSliceBvhItemKeys({ mesh, slicePlan }),
			layerPlan: slicePlan.layerPlan,
		},
	];
}

function createTerrainDrawSliceUploadPlansFromArtifact({
	id,
	mesh,
	slice,
}: {
	id: string;
	mesh: LandblockTerrainRenderArtifact["mesh"];
	slice: TerrainRenderDrawSliceArtifact;
}): TerrainTileDrawSliceUploadPlan[] {
	if (slice.geometry.triangleCount === 0) {
		return [];
	}
	return [
		{
			id,
			reason: slice.slicePlan.reason,
			geometrySignature: describeTerrainTileGeometrySignature(slice.geometry),
			geometry: slice.geometry,
			vertexCount: slice.geometry.indices.length,
			triangleCount: slice.geometry.triangleCount,
			bvhItemKeys: deriveTerrainDrawSliceBvhItemKeys({
				mesh,
				slicePlan: slice.slicePlan,
			}),
			layerPlan: slice.slicePlan.layerPlan,
		},
	];
}

function createOrReuseWebgl2TerrainTileDrawSlices({
	gl,
	parentTerrainTileId,
	renderChunkKey,
	plans,
	previousSlices,
}: {
	gl: WebGL2RenderingContext;
	parentTerrainTileId: string;
	renderChunkKey: RenderChunkTransform["chunkKey"];
	plans: readonly TerrainTileDrawSliceUploadPlan[];
	previousSlices: readonly Webgl2TerrainTileDrawSliceResource[];
}): Webgl2TerrainTileDrawSliceResource[] {
	const previousById = new Map(
		previousSlices.map((slice) => [slice.id, slice] as const),
	);
	const retainedIds = new Set<string>();
	const slices = plans.map((plan) => {
		const previous = previousById.get(plan.id);
		if (previous && previous.geometrySignature === plan.geometrySignature) {
			retainedIds.add(previous.id);
			previous.renderChunkKey = renderChunkKey;
			previous.reason = plan.reason;
			previous.vertexCount = plan.vertexCount;
			previous.triangleCount = plan.triangleCount;
			previous.bvhItemKeys = [...plan.bvhItemKeys];
			previous.layerPlan = plan.layerPlan;
			previous.detailPlan = null;
			previous.texturePageBindings = [];
			previous.texturePageBlockers = [];
			previous.oneDrawReadiness = createBlockedTerrainTileOneDrawReadiness([
				"terrain draw slice texture page bindings are unresolved",
			]);
			return previous;
		}
		return createWebgl2TerrainTileDrawSliceFromUploadPlan({
			gl,
			parentTerrainTileId,
			renderChunkKey,
			plan,
		});
	});
	for (const slice of previousSlices) {
		if (!retainedIds.has(slice.id) && !slices.includes(slice)) {
			destroyWebgl2TerrainTileDrawSlice(slice);
		}
	}
	return slices;
}

function createWebgl2TerrainTileDrawSliceFromUploadPlan({
	gl,
	parentTerrainTileId,
	renderChunkKey,
	plan,
}: {
	gl: WebGL2RenderingContext;
	parentTerrainTileId: string;
	renderChunkKey: RenderChunkTransform["chunkKey"];
	plan: TerrainTileDrawSliceUploadPlan;
}): Webgl2TerrainTileDrawSliceResource {
	const buffers = createWebgl2IndexedGeometryBuffers(gl, {
		id: plan.id,
		geometry: plan.geometry,
	});
	if (!buffers.uvBuffer || !buffers.layerSlotBuffer) {
		throw new Error(
			`Terrain draw slice ${plan.id} was created without layer geometry buffers.`,
		);
	}
	return {
		id: plan.id,
		parentTerrainTileId,
		reason: plan.reason,
		geometrySignature: plan.geometrySignature,
		...buffers,
		uvBuffer: buffers.uvBuffer,
		layerSlotBuffer: buffers.layerSlotBuffer,
		vertexCount: plan.vertexCount,
		triangleCount: plan.triangleCount,
		renderChunkKey,
		bvhItemKeys: [...plan.bvhItemKeys],
		layerPlan: plan.layerPlan,
		detailPlan: null,
		texturePageBindings: [],
		texturePageBlockers: [],
		oneDrawReadiness: createBlockedTerrainTileOneDrawReadiness([
			"terrain draw slice texture page bindings are unresolved",
		]),
	};
}

function deriveTerrainDrawSliceBvhItemKeys({
	mesh,
	slicePlan,
}: {
	mesh: LandblockTerrainRenderArtifact["mesh"];
	slicePlan: TerrainTileDrawSlicePlan;
}): RenderBvhItemKey[] {
	return mesh.quads
		.filter((quad) => slicePlan.layerPlan.layerSlotByPcode.has(quad.pcode))
		.map(
			(quad): RenderBvhItemKey =>
				quad.terrainQuadId
					.replace(/^terrain\//, "terrain:landblock:")
					.replace("/quad/", ":quad:") as RenderBvhItemKey,
		);
}

function createWebgl2IndexedGeometryBuffers(
	gl: WebGL2RenderingContext,
	{
		id,
		geometry,
	}: {
		id: string;
		geometry: RenderIndexedGeometry | TerrainTileLayerGeometry;
	},
): Pick<
	Webgl2TerrainTileResource,
	| "vertexArray"
	| "vertexBuffer"
	| "uvBuffer"
	| "layerSlotBuffer"
	| "indexBuffer"
	| "indexType"
> {
	const vertexBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${id}/positions`,
		data: geometry.positions,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${id}/indices`,
		data: geometry.indices,
	});
	const uvBuffer = geometry.uvs
		? createWebgl2ArrayBuffer(gl, {
				label: `${id}/uvs`,
				data: geometry.uvs,
			})
		: null;
	const layerSlotBuffer =
		"layerSlots" in geometry
			? createWebgl2ArrayBuffer(gl, {
					label: `${id}/terrain-layer-slots`,
					data: geometry.layerSlots,
				})
			: null;
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${id}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			if (uvBuffer) {
				gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer.buffer);
				gl.enableVertexAttribArray(1);
				gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
			}
			if (layerSlotBuffer) {
				gl.bindBuffer(gl.ARRAY_BUFFER, layerSlotBuffer.buffer);
				gl.enableVertexAttribArray(2);
				gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
			}
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		vertexArray,
		vertexBuffer,
		uvBuffer,
		layerSlotBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
	};
}

function deriveWebgl2TerrainArtifactReadiness(
	artifact: LandblockTerrainRenderArtifact,
): Webgl2TerrainTileReadiness {
	if (artifact.materialResources.status === "ready") {
		return {
			status: "ready",
			terrainMaterialAssetId: artifact.materialResources.terrainMaterialAssetId,
		};
	}
	return {
		status: "fallback-debug",
		reason: "terrain material resources are unresolved",
	};
}

function describeTerrainTileReadinessSignature(
	readiness: Webgl2TerrainTileReadiness,
): string {
	return readiness.status === "ready"
		? `${readiness.status}:${readiness.terrainMaterialAssetId}`
		: `${readiness.status}:${readiness.reason}`;
}

function collectTerrainTexturePageAtlasCandidates({
	assetReadModel,
	terrainTiles,
	materialTextureCapabilities,
	textureFilteringMode,
	detailTexturesEnabled,
	reportDiagnostic,
}: {
	assetReadModel: RendererAssetReadModel;
	terrainTiles: readonly Webgl2TerrainTileResource[];
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	detailTexturesEnabled: boolean;
	reportDiagnostic?: (message: string) => void;
}): {
	rgbaCandidates: TexturePageAtlasRgbaCandidate[];
	detailCandidates: TexturePageAtlasDetailCandidate[];
	cohorts: TexturePageAtlasCohort[];
	blockersByTerrainTileId: ReadonlyMap<string, readonly string[]>;
	refCount: number;
} {
	const rgbaCandidates: TexturePageAtlasRgbaCandidate[] = [];
	const detailCandidates: TexturePageAtlasDetailCandidate[] = [];
	const cohorts: TexturePageAtlasCohort[] = [];
	const blockersByTerrainTileId = new Map<string, string[]>();
	let refCount = 0;
	for (const tile of terrainTiles) {
		tile.detailPlan = null;
		cohorts.push(...createTerrainTexturePageAtlasCohorts(tile));
		const refs = collectTerrainTileTextureRefs(tile);
		refCount += refs.length;
		if (refs.length === 0) {
			addTerrainTilePageBlocker(
				blockersByTerrainTileId,
				tile.id,
				"terrain tile has no terrain blend page inputs",
			);
		}
		for (const ref of refs) {
			const readiness = createTerrainTexturePageReadiness({
				assetReadModel,
				ref,
				tile,
				blockersByTerrainTileId,
			});
			if (!readiness) {
				continue;
			}
			rgbaCandidates.push({
				candidateId: tile.id,
				bucket: ref.role === "mask" ? "terrain-mask" : "terrain-color",
				texturePageReadiness: readiness,
				detailAtlasEntry: null,
			});
		}
		if (
			detailTexturesEnabled &&
			tile.terrainArtifactTexturePageRefs.length === 0
		) {
			const detailPlan = resolveTerrainTileDetailPlan({
				assetReadModel,
				tile,
				materialTextureCapabilities,
				textureFilteringMode,
				reportDiagnostic,
			});
			tile.detailPlan = detailPlan?.plan ?? null;
			if (detailPlan?.candidate) {
				detailCandidates.push(detailPlan.candidate);
			}
		}
	}
	return {
		rgbaCandidates,
		detailCandidates,
		cohorts,
		blockersByTerrainTileId,
		refCount,
	};
}

function resolveTerrainTileDetailPlan({
	assetReadModel,
	tile,
	materialTextureCapabilities,
	textureFilteringMode,
	reportDiagnostic,
}: {
	assetReadModel: RendererAssetReadModel;
	tile: Webgl2TerrainTileResource;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	reportDiagnostic?: (message: string) => void;
}): {
	plan: Webgl2TerrainTileDetailPlan;
	candidate: TexturePageAtlasDetailCandidate | null;
} | null {
	const overlay = resolveRegionDetailOverlayPlan({
		assetReadModel,
		regionNumber: tile.regionNumber,
		roleKind: "landscape",
		reportDiagnostic,
	});
	if (!overlay) {
		return null;
	}
	const upload = prepareTerrainDetailTextureUpload({
		assetReadModel,
		overlay,
		materialTextureCapabilities,
		textureFilteringMode,
		reportDiagnostic,
	});
	const atlasEntryKey = describeTerrainDetailAtlasEntryKey(overlay);
	return {
		plan: { overlay, atlasEntryKey },
		candidate: upload
			? {
					candidateId: tile.id,
					bucket: "terrain-detail",
					detailAtlasEntry: {
						key: atlasEntryKey,
						renderSurfaceId: overlay.renderSurface.renderSurfaceId,
						sourceFormatRaw: overlay.renderSurface.formatRaw,
						width: upload.upload.width,
						height: upload.upload.height,
						bytes: upload.upload.data,
						format: "rgba8",
						tiling: overlay.role.tiling,
						blendMode: overlay.blendMode,
					},
				}
			: null,
	};
}

function prepareTerrainDetailTextureUpload({
	assetReadModel,
	overlay,
	materialTextureCapabilities,
	textureFilteringMode,
	reportDiagnostic,
}: {
	assetReadModel: RendererAssetReadModel;
	overlay: ResolvedRegionDetailOverlayPlan;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	reportDiagnostic?: (message: string) => void;
}):
	| (RenderSurfaceTextureUploadPreparation & {
			status: "ready";
			upload: {
				kind: "direct";
				format: "rgba";
				dataType: "uint8";
				width: number;
				height: number;
				data: Uint8Array;
			};
	  })
	| null {
	const defaultPolicy = selectRenderSurfaceTextureSamplingPolicy(
		overlay.renderSurface,
		createDefaultMaterialTextureSamplingPolicy(
			materialTextureCapabilities,
			textureFilteringMode,
		),
	);
	const samplingPolicy = {
		...defaultPolicy,
		wrapS: "repeat" as const,
		wrapT: "repeat" as const,
		colorSpace: "none" as const,
	};
	const upload = prepareRenderSurfaceTextureUploadData(
		overlay.renderSurface,
		samplingPolicy,
		materialTextureCapabilities,
		resolvePreparedTextureForRenderSurface(
			assetReadModel,
			overlay.renderSurface,
			"detail",
		),
	);
	if (upload.status !== "ready") {
		reportDiagnostic?.(
			`terrain-detail ${overlay.signature} texture ${formatHex32(overlay.renderSurface.renderSurfaceId)} is ${upload.reason}`,
		);
		return null;
	}
	if (
		upload.upload.kind !== "direct" ||
		upload.upload.format !== "rgba" ||
		upload.upload.dataType !== "uint8" ||
		!(upload.upload.data instanceof Uint8Array)
	) {
		reportDiagnostic?.(
			`terrain-detail ${overlay.signature} texture ${formatHex32(overlay.renderSurface.renderSurfaceId)} is not rgba8 atlas-compatible`,
		);
		return null;
	}
	return upload as RenderSurfaceTextureUploadPreparation & {
		status: "ready";
		upload: {
			kind: "direct";
			format: "rgba";
			dataType: "uint8";
			width: number;
			height: number;
			data: Uint8Array;
		};
	};
}

function describeTerrainDetailAtlasEntryKey(
	overlay: ResolvedRegionDetailOverlayPlan,
): string {
	return [
		"terrain-detail",
		overlay.regionNumber,
		overlay.roleKind,
		overlay.role.textureAssetId,
		formatHex32(overlay.renderSurface.renderSurfaceId),
		overlay.renderSurface.formatRaw,
		overlay.renderSurface.width,
		overlay.renderSurface.height,
		overlay.role.tiling,
		overlay.role.fadeNear,
		overlay.role.fadeFar,
	].join("/");
}

function collectTerrainTileTextureRefs(
	tile: Webgl2TerrainTileResource,
): TerrainBlendTextureRef[] {
	const refs = [
		...(tile.layerPlan
			? collectTerrainLayerPlanTextureRefs(tile.layerPlan)
			: []),
		...tile.drawSlices.flatMap((slice) =>
			collectTerrainLayerPlanTextureRefs(slice.layerPlan),
		),
	];
	const refsByKey = new Map(
		refs.map((ref) => [describeTerrainTexturePageRefKey(ref), ref] as const),
	);
	return [...refsByKey.values()].sort((left, right) =>
		describeTerrainTexturePageRefKey(left).localeCompare(
			describeTerrainTexturePageRefKey(right),
		),
	);
}

function createTerrainTexturePageAtlasCohorts(
	tile: Webgl2TerrainTileResource,
): TexturePageAtlasCohort[] {
	const cohorts: TexturePageAtlasCohort[] = [];
	if (tile.layerPlan) {
		cohorts.push(
			...createTerrainLayerPlanTexturePageAtlasCohorts({
				ownerKey: `${tile.id}/tile`,
				layerPlan: tile.layerPlan,
			}),
		);
	}
	for (const slice of tile.drawSlices) {
		cohorts.push(
			...createTerrainLayerPlanTexturePageAtlasCohorts({
				ownerKey: `${slice.id}/slice`,
				layerPlan: slice.layerPlan,
			}),
		);
	}
	return cohorts;
}

function createTerrainLayerPlanTexturePageAtlasCohorts({
	ownerKey,
	layerPlan,
}: {
	ownerKey: string;
	layerPlan: TerrainTileLayerPlan;
}): TexturePageAtlasCohort[] {
	return [
		createTerrainLayerPlanTexturePageAtlasCohort({
			key: `${ownerKey}/terrain-color`,
			bucket: "terrain-color",
			refs: collectTerrainLayerPlanTextureRefsByRole(layerPlan, "color"),
		}),
		createTerrainLayerPlanTexturePageAtlasCohort({
			key: `${ownerKey}/terrain-mask`,
			bucket: "terrain-mask",
			refs: collectTerrainLayerPlanTextureRefsByRole(layerPlan, "mask"),
		}),
	].filter((cohort): cohort is TexturePageAtlasCohort => cohort !== null);
}

function createTerrainLayerPlanTexturePageAtlasCohort({
	key,
	bucket,
	refs,
}: {
	key: string;
	bucket: TexturePageAtlasCohort["bucket"];
	refs: readonly TerrainBlendTextureRef[];
}): TexturePageAtlasCohort | null {
	const atlasEntryKeys = uniqueSortedStrings(
		refs.map(describeTerrainBlendTextureAtlasEntryKey),
	);
	if (atlasEntryKeys.length === 0) {
		return null;
	}
	return { key, bucket, atlasEntryKeys };
}

function collectTerrainLayerPlanTextureRefsByRole(
	layerPlan: TerrainTileLayerPlan,
	role: TerrainBlendTextureRef["role"],
): TerrainBlendTextureRef[] {
	const refs = layerPlan.layerEntries.flatMap((entry) =>
		role === "color"
			? [
					entry.plan.base,
					...entry.plan.overlays.map((overlay) => overlay.terrain),
					...entry.plan.roads.map((road) => road.road),
				]
			: [
					...entry.plan.overlays.map((overlay) => overlay.alpha),
					...entry.plan.roads.map((road) => road.alpha),
				],
	);
	const refsByKey = new Map(
		refs.map(
			(ref) => [describeTerrainBlendTextureAtlasEntryKey(ref), ref] as const,
		),
	);
	return [...refsByKey.values()].sort((left, right) =>
		describeTerrainBlendTextureAtlasEntryKey(left).localeCompare(
			describeTerrainBlendTextureAtlasEntryKey(right),
		),
	);
}

function createTerrainTexturePageReadiness({
	assetReadModel,
	ref,
	tile,
	blockersByTerrainTileId,
}: {
	assetReadModel: RendererAssetReadModel;
	ref: TerrainBlendTextureRef;
	tile: Webgl2TerrainTileResource;
	blockersByTerrainTileId: Map<string, string[]>;
}): RenderMaterialTexturePageReadiness | null {
	const artifactReadiness = createTerrainArtifactTexturePageReadiness({
		ref,
		tile,
	});
	if (artifactReadiness) {
		return artifactReadiness;
	}
	if (tile.terrainArtifactTexturePageRefs.length > 0) {
		addTerrainTilePageBlocker(
			blockersByTerrainTileId,
			tile.id,
			`missing terrain artifact ${ref.role} page texture ${formatHex32(ref.renderSurface.renderSurfaceId)}`,
		);
		return null;
	}

	const preparedTexture = resolvePreparedTextureForRenderSurface(
		assetReadModel,
		ref.renderSurface,
		"raw",
	);
	const level = preparedTexture?.levels[0] ?? null;
	if (!preparedTexture || !level) {
		addTerrainTilePageBlocker(
			blockersByTerrainTileId,
			tile.id,
			`missing terrain ${ref.role} page texture ${formatHex32(ref.renderSurface.renderSurfaceId)}`,
		);
		return null;
	}
	const atlasEntryKey = describeTerrainBlendTextureAtlasEntryKey(ref);
	const samplingKey = [
		"terrain",
		ref.role,
		`wrap=${ref.wrap}`,
		`tiling=${ref.tiling}`,
	].join("|");
	const renderStateKey = `terrain-${ref.role}`;
	return {
		materialSlotKey: `${tile.id}/${atlasEntryKey}`,
		atlasEntryKey,
		renderStateKey,
		samplingKey,
		samplingPolicy: {
			wrapS: ref.wrap,
			wrapT: ref.wrap,
		},
		atlasEntry: {
			renderSurfaceId: ref.renderSurface.renderSurfaceId,
			preparedTextureAssetId: describePreparedTextureAssetId(preparedTexture),
			level,
			sourceHash: preparedTexture.sourceHash,
			sourceFormatRaw: preparedTexture.sourceFormatRaw,
		},
	};
}

function createTerrainArtifactTexturePageReadiness({
	ref,
	tile,
}: {
	ref: TerrainBlendTextureRef;
	tile: Webgl2TerrainTileResource;
}): RenderMaterialTexturePageReadiness | null {
	const artifactRef = tile.terrainArtifactTexturePageRefs.find(
		(candidate) =>
			candidate.role === ref.role &&
			candidate.renderSurfaceId === ref.renderSurface.renderSurfaceId,
	);
	if (!artifactRef) {
		return null;
	}
	const atlasEntryKey = describeTerrainBlendTextureAtlasEntryKey(ref);
	const samplingKey = [
		"terrain-artifact",
		ref.role,
		`wrapS=${artifactRef.wrapS}`,
		`wrapT=${artifactRef.wrapT}`,
		`tiling=${artifactRef.tiling}`,
	].join("|");
	return {
		materialSlotKey: `${tile.id}/${atlasEntryKey}`,
		atlasEntryKey,
		renderStateKey: `terrain-${ref.role}`,
		samplingKey,
		samplingPolicy: {
			wrapS: artifactRef.wrapS,
			wrapT: artifactRef.wrapT,
		},
		atlasEntry: {
			renderSurfaceId: artifactRef.renderSurfaceId,
			preparedTextureAssetId: `terrain-artifact-texture/${tile.assetId}/${artifactRef.key}`,
			level: {
				level: 0,
				width: artifactRef.width,
				height: artifactRef.height,
				formatRaw: artifactRef.formatRaw,
				format: artifactRef.format,
				byteLength: artifactRef.bytes.byteLength,
				bytes: artifactRef.bytes,
			},
			sourceHash: [
				tile.assetId,
				artifactRef.key,
				artifactRef.width,
				artifactRef.height,
				artifactRef.bytes.byteLength,
			].join(":"),
			sourceFormatRaw: artifactRef.formatRaw,
		},
	};
}

function describePreparedTextureAssetId(
	preparedTexture: PreparedTexturePayload,
): string {
	return `prepared-texture/${formatHex32(preparedTexture.renderSurfaceId)}?usage=${preparedTexture.usage}&out=${preparedTexture.outputFormat}&mips=${preparedTexture.mipPolicy}&cs=${preparedTexture.colorSpace}`;
}

function describeTerrainTexturePageRefKey(ref: TerrainBlendTextureRef): string {
	return [
		ref.role,
		ref.textureAssetId,
		formatHex32(ref.renderSurface.renderSurfaceId),
		ref.wrap,
		ref.tiling,
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function addTerrainTilePageBlocker(
	blockersByTerrainTileId: Map<string, string[]>,
	terrainTileId: string,
	blocker: string,
): void {
	const blockers = blockersByTerrainTileId.get(terrainTileId) ?? [];
	if (!blockers.includes(blocker)) {
		blockers.push(blocker);
	}
	blockersByTerrainTileId.set(terrainTileId, blockers);
}

function applyTerrainTexturePageBlockers({
	terrainTiles,
	blockersByTerrainTileId,
}: {
	terrainTiles: readonly Webgl2TerrainTileResource[];
	blockersByTerrainTileId: ReadonlyMap<string, readonly string[]>;
}): void {
	for (const tile of terrainTiles) {
		tile.texturePageBlockers = [
			...(blockersByTerrainTileId.get(tile.id) ?? []),
		];
		tile.texturePageBindings = [];
	}
}

function resolveWebgl2TerrainTileTexturePageBindings({
	gl,
	store,
	terrainTiles,
	plan,
	texturePagesByBucketIndex,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	terrainTiles: readonly Webgl2TerrainTileResource[];
	plan: TexturePageAtlasPlan;
	texturePagesByBucketIndex: ReadonlyMap<
		string,
		Webgl2TerrainTexturePageResource
	>;
}): void {
	const placementsByEntryKey = createTexturePageAtlasPlacementsByEntryKey(plan);
	const detailPlacementsByEntryKey =
		createTexturePageDetailAtlasPlacementsByEntryKey(plan);
	for (const tile of terrainTiles) {
		const bindings: Webgl2TerrainTileTexturePageBinding[] = [];
		const blockers = [...tile.texturePageBlockers];
		const refs = collectTerrainTileTextureRefs(tile);
		for (const ref of refs) {
			const atlasEntryKey = describeTerrainBlendTextureAtlasEntryKey(ref);
			const placement = placementsByEntryKey.get(atlasEntryKey) ?? null;
			if (!placement) {
				blockers.push(
					`missing terrain ${ref.role} page placement ${atlasEntryKey}`,
				);
				continue;
			}
			const bucket = ref.role === "mask" ? "terrain-mask" : "terrain-color";
			const texturePage = resolveTerrainTexturePageResource({
				texturePagesByBucketIndex,
				bucket,
				textureIndex: placement.textureIndex,
			});
			if (!texturePage) {
				blockers.push(
					`missing terrain ${ref.role} page texture ${placement.textureIndex} for ${atlasEntryKey}`,
				);
				continue;
			}
			bindings.push({
				bucket,
				atlasEntryKey,
				textureIndex: placement.textureIndex,
				rect: [placement.x, placement.y, placement.width, placement.height],
				texturePage,
			});
		}
		if (tile.detailPlan) {
			const placement =
				detailPlacementsByEntryKey.get(tile.detailPlan.atlasEntryKey) ?? null;
			if (placement) {
				const texturePage = resolveTerrainTexturePageResource({
					texturePagesByBucketIndex,
					bucket: "terrain-detail",
					textureIndex: placement.textureIndex,
				});
				if (texturePage) {
					bindings.push({
						bucket: "terrain-detail",
						atlasEntryKey: tile.detailPlan.atlasEntryKey,
						textureIndex: placement.textureIndex,
						rect: [placement.x, placement.y, placement.width, placement.height],
						texturePage,
					});
				} else {
					recordMaterialFallbackReason(
						store,
						`missing terrain detail texture page ${placement.textureIndex} for ${tile.detailPlan.atlasEntryKey}`,
					);
				}
			} else {
				recordMaterialFallbackReason(
					store,
					`missing terrain detail atlas placement ${tile.detailPlan.atlasEntryKey}`,
				);
			}
		}
		tile.texturePageBindings = dedupeTerrainTexturePageBindings(bindings);
		tile.texturePageBlockers = [...new Set(blockers)];
		tile.oneDrawReadiness = deriveTerrainTileOneDrawReadiness(tile);
		resolveTerrainDrawSliceTexturePageBindings(tile);
		if (tile.oneDrawReadiness.status === "blocked") {
			tile.drawSlices.push(
				...createWebgl2TerrainTilePageOverflowDrawSlices({
					gl,
					tile,
				}),
			);
			resolveTerrainDrawSliceTexturePageBindings(tile);
		}
	}
}

function resolveTerrainTexturePageResource({
	texturePagesByBucketIndex,
	bucket,
	textureIndex,
}: {
	texturePagesByBucketIndex: ReadonlyMap<
		string,
		Webgl2TerrainTexturePageResource
	>;
	bucket: Webgl2TerrainTexturePageResource["bucket"];
	textureIndex: number;
}): Webgl2TerrainTexturePageResource | null {
	return (
		texturePagesByBucketIndex.get(
			describeTerrainTexturePageBucketIndexKey({
				bucket,
				textureIndex,
			}),
		) ?? null
	);
}

function rebuildTerrainTexturePageBucketIndex({
	texturePagesByKey,
	texturePagesByBucketIndex,
}: {
	texturePagesByKey: ReadonlyMap<string, Webgl2TerrainTexturePageResource>;
	texturePagesByBucketIndex: Map<string, Webgl2TerrainTexturePageResource>;
}): void {
	texturePagesByBucketIndex.clear();
	for (const page of texturePagesByKey.values()) {
		texturePagesByBucketIndex.set(
			describeTerrainTexturePageBucketIndexKey({
				bucket: page.bucket,
				textureIndex: page.textureIndex,
			}),
			page,
		);
	}
}

function describeTerrainTexturePageBucketIndexKey({
	bucket,
	textureIndex,
}: {
	bucket: Webgl2TerrainTexturePageResource["bucket"];
	textureIndex: number;
}): string {
	return `${bucket}:${textureIndex}`;
}

function createWebgl2TerrainTilePageOverflowDrawSlices({
	gl,
	tile,
}: {
	gl: WebGL2RenderingContext;
	tile: Webgl2TerrainTileResource;
}): Webgl2TerrainTileDrawSliceResource[] {
	if (!tile.layerPlan || tile.layerPlan.blockers.length > 0) {
		return [];
	}
	const layerPlan = tile.layerPlan;
	if (
		tile.oneDrawReadiness.status !== "blocked" ||
		!tile.oneDrawReadiness.blockers.some(isTerrainPageOverflowBlocker)
	) {
		return [];
	}
	const sliceGroups = groupTerrainLayerEntriesByPage(tile);
	if (sliceGroups.length <= 1) {
		return [];
	}
	return sliceGroups.flatMap((group, groupIndex) => {
		const sliceLayerPlan = createTerrainPageOverflowSliceLayerPlan({
			parentPlan: layerPlan,
			entries: group.entries,
			groupIndex,
		});
		return createTerrainDrawSliceUploadPlans({
			id: `${tile.id}/page-slice/${groupIndex}`,
			reason: group.reason,
			mesh: tile.mesh,
			slicePlan: {
				id: `page-slice/${groupIndex}`,
				reason: group.reason,
				layerPlan: sliceLayerPlan,
				pcodes: group.entries.map((entry) => entry.pcode),
			},
		}).map((plan) =>
			createWebgl2TerrainTileDrawSliceFromUploadPlan({
				gl,
				parentTerrainTileId: tile.id,
				renderChunkKey: tile.renderChunkKey,
				plan,
			}),
		);
	});
}

function isTerrainPageOverflowBlocker(blocker: string): boolean {
	return (
		blocker.includes("terrain color atlas textures") ||
		blocker.includes("terrain mask atlas textures")
	);
}

function groupTerrainLayerEntriesByPage(
	tile: Webgl2TerrainTileResource,
): Array<{
	entries: TerrainTileLayerEntry[];
	reason: string;
}> {
	const groupsByKey = new Map<
		string,
		{
			entries: TerrainTileLayerEntry[];
			colorTextureIndex: number | null;
			maskTextureIndex: number | null;
		}
	>();
	for (const entry of tile.layerPlan?.layerEntries ?? []) {
		const textureIndices = collectTerrainLayerEntryTextureIndices({
			entry,
			bindings: tile.texturePageBindings,
		});
		if (
			textureIndices.colorTextureIndices.length > 1 ||
			textureIndices.maskTextureIndices.length > 1
		) {
			continue;
		}
		const colorTextureIndex = textureIndices.colorTextureIndices[0] ?? null;
		const maskTextureIndex = textureIndices.maskTextureIndices[0] ?? null;
		const key = `color:${colorTextureIndex ?? "none"}|mask:${maskTextureIndex ?? "none"}`;
		const group = groupsByKey.get(key) ?? {
			entries: [],
			colorTextureIndex,
			maskTextureIndex,
		};
		group.entries.push(entry);
		groupsByKey.set(key, group);
	}
	return [...groupsByKey.values()]
		.filter((group) => group.entries.length > 0)
		.map((group) => ({
			entries: group.entries,
			reason: [
				"terrain tile page overflow",
				`color=${group.colorTextureIndex ?? "none"}`,
				`mask=${group.maskTextureIndex ?? "none"}`,
			].join(" "),
		}));
}

function collectTerrainLayerEntryTextureIndices({
	entry,
	bindings,
}: {
	entry: TerrainTileLayerEntry;
	bindings: readonly Webgl2TerrainTileTexturePageBinding[];
}): {
	colorTextureIndices: number[];
	maskTextureIndices: number[];
} {
	const colorTextureIndices = collectTerrainRefsTextureIndices({
		refs: [
			entry.plan.base,
			...entry.plan.overlays.map((overlay) => overlay.terrain),
			...entry.plan.roads.map((road) => road.road),
		],
		bindings,
	});
	const maskTextureIndices = collectTerrainRefsTextureIndices({
		refs: [
			...entry.plan.overlays.map((overlay) => overlay.alpha),
			...entry.plan.roads.map((road) => road.alpha),
		],
		bindings,
	});
	return { colorTextureIndices, maskTextureIndices };
}

function collectTerrainRefsTextureIndices({
	refs,
	bindings,
}: {
	refs: readonly TerrainBlendTextureRef[];
	bindings: readonly Webgl2TerrainTileTexturePageBinding[];
}): number[] {
	return [
		...new Set(
			refs.flatMap((ref) => {
				const atlasEntryKey = describeTerrainBlendTextureAtlasEntryKey(ref);
				const binding = bindings.find(
					(candidate) => candidate.atlasEntryKey === atlasEntryKey,
				);
				return binding?.textureIndex == null ? [] : [binding.textureIndex];
			}),
		),
	].sort((left, right) => left - right);
}

function createTerrainPageOverflowSliceLayerPlan({
	parentPlan,
	entries,
	groupIndex,
}: {
	parentPlan: TerrainTileLayerPlan;
	entries: readonly TerrainTileLayerEntry[];
	groupIndex: number;
}): TerrainTileLayerPlan {
	const layerEntries = entries.map((entry, slot) => ({
		...entry,
		slot,
	}));
	return {
		layerEntries,
		layerSlotByPcode: new Map(
			layerEntries.map((entry) => [entry.pcode, entry.slot] as const),
		),
		blockers: [],
		signature: `${parentPlan.signature}|page-slice:${groupIndex}|layers:${layerEntries.map((entry) => `${entry.slot}:${entry.pcode}`).join(",")}`,
	};
}

function resolveTerrainDrawSliceTexturePageBindings(
	tile: Webgl2TerrainTileResource,
): void {
	for (const slice of tile.drawSlices) {
		slice.detailPlan = tile.detailPlan;
		const atlasEntryKeys = new Set(
			collectTerrainLayerPlanTextureRefs(slice.layerPlan).map((ref) =>
				describeTerrainBlendTextureAtlasEntryKey(ref),
			),
		);
		if (tile.detailPlan) {
			atlasEntryKeys.add(tile.detailPlan.atlasEntryKey);
		}
		slice.texturePageBindings = tile.texturePageBindings.filter((binding) =>
			atlasEntryKeys.has(binding.atlasEntryKey),
		);
		slice.texturePageBlockers = tile.texturePageBlockers.filter((blocker) =>
			[...atlasEntryKeys].some((atlasEntryKey) =>
				blocker.includes(atlasEntryKey),
			),
		);
		slice.oneDrawReadiness = deriveTerrainDrawSliceOneDrawReadiness(slice);
	}
}

function collectTerrainLayerPlanTextureRefs(
	layerPlan: TerrainTileLayerPlan,
): TerrainBlendTextureRef[] {
	const refs = layerPlan.layerEntries.flatMap((entry) => [
		entry.plan.base,
		...entry.plan.overlays.flatMap((overlay) => [
			overlay.terrain,
			overlay.alpha,
		]),
		...entry.plan.roads.flatMap((road) => [road.road, road.alpha]),
	]);
	const refsByKey = new Map(
		refs.map(
			(ref) =>
				[
					`${ref.role}/${describeTerrainBlendTextureAtlasEntryKey(ref)}`,
					ref,
				] as const,
		),
	);
	return [...refsByKey.values()];
}

function dedupeTerrainTexturePageBindings(
	bindings: readonly Webgl2TerrainTileTexturePageBinding[],
): Webgl2TerrainTileTexturePageBinding[] {
	const bindingByKey = new Map(
		bindings.map(
			(binding) =>
				[`${binding.bucket}/${binding.atlasEntryKey}`, binding] as const,
		),
	);
	return [...bindingByKey.values()].sort((left, right) =>
		`${left.bucket}/${left.atlasEntryKey}`.localeCompare(
			`${right.bucket}/${right.atlasEntryKey}`,
		),
	);
}

function resolvePreparedTextureForRenderSurface(
	assetReadModel: RendererAssetReadModel,
	renderSurface: TerrainBlendTextureRef["renderSurface"],
	usage: "raw" | "detail" = "raw",
): PreparedTexturePayload | null {
	for (const assetId of resolveNormalizedPreparedTextureAssetIds({
		renderSurface,
		usage,
	})) {
		const asset = assetReadModel.get(assetId);
		if (asset?.payload.kind === "prepared-texture") {
			return asset.payload;
		}
	}
	return null;
}

function defaultWebgl2MaterialTextureCapabilities() {
	return {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
		supportsPackedRgb565: false,
		supportsPackedRgba4444: true,
		maxAnisotropy: 1,
	};
}

function createTransitionPortalMaskGeometrySignature(
	assembly: TransitionPortalMaskResourceAssembly,
): string {
	return [
		assembly.kind,
		assembly.geometry.signature,
		`v${assembly.geometry.vertexCount}`,
		`t${assembly.geometry.triangleCount}`,
		`p${assembly.geometry.positions.length}`,
		`i${assembly.geometry.indices.length}`,
	].join(":");
}

function syncWebgl2TerrainTexturePageResources({
	gl,
	texturePagesByKey,
	texturePagesByBucketIndex,
	plan,
	textureFilteringMode,
	maxAnisotropy,
}: {
	gl: WebGL2RenderingContext;
	texturePagesByKey: Map<string, Webgl2TerrainTexturePageResource>;
	texturePagesByBucketIndex: Map<string, Webgl2TerrainTexturePageResource>;
	plan: TexturePageAtlasPlan;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): void {
	const terrainPlan = createTerrainTexturePageGenerationPlan({
		plan,
		textureFilteringMode,
		maxAnisotropy,
	});
	if (!terrainPlan) {
		clearWebgl2TerrainTexturePageResources(texturePagesByKey);
		texturePagesByBucketIndex.clear();
		return;
	}
	const retainedKeys = new Set<string>();
	for (const cpuTexture of [
		...terrainPlan.cpuSet.textures,
		...terrainPlan.cpuSet.detailTextures,
	]) {
		retainedKeys.add(cpuTexture.key);
		if (texturePagesByKey.has(cpuTexture.key)) {
			continue;
		}
		const texturePage = createWebgl2TerrainTexturePageResource(
			createWebgl2TexturePageTextureResourceFromCpu({
				gl,
				cpuTexture,
				textureFilteringMode,
				maxAnisotropy,
			}),
		);
		texturePagesByKey.set(cpuTexture.key, texturePage);
	}
	for (const [key, texturePage] of texturePagesByKey) {
		if (!retainedKeys.has(key)) {
			texturePage.texture.dispose();
			texturePagesByKey.delete(key);
		}
	}
	rebuildTerrainTexturePageBucketIndex({
		texturePagesByKey,
		texturePagesByBucketIndex,
	});
}

function createWebgl2TerrainTexturePageResource(
	texturePage: ReturnType<typeof createWebgl2TexturePageTextureResourceFromCpu>,
): Webgl2TerrainTexturePageResource {
	if (!isTerrainTexturePageBucket(texturePage.bucket)) {
		throw new Error(
			`Terrain texture page ${texturePage.key} has non-terrain bucket ${texturePage.bucket}.`,
		);
	}
	if (!texturePage.pixelStats || !texturePage.entryDiagnostics) {
		throw new Error(
			`Terrain texture page ${texturePage.key} is missing required texture-page diagnostics.`,
		);
	}
	return {
		...texturePage,
		bucket: texturePage.bucket,
		pixelStats: texturePage.pixelStats,
		entryDiagnostics: texturePage.entryDiagnostics,
	};
}

function createTerrainTexturePageGenerationPlan({
	plan,
	textureFilteringMode,
	maxAnisotropy,
}: {
	plan: TexturePageAtlasPlan;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): { cpuSet: TexturePageCpuSet } | null {
	const terrainBuckets = plan.buckets
		.map((bucketPlan) => ({
			...bucketPlan,
			atlasEntryRecords: bucketPlan.atlasEntryRecords.filter((record) =>
				record.key.startsWith("terrain-page/"),
			),
			atlasTextures: bucketPlan.atlasTextures
				.map((page) => ({
					...page,
					placements: page.placements.filter((placement) =>
						placement.atlasEntryKey.startsWith("terrain-page/"),
					),
				}))
				.filter((page) => page.placements.length > 0),
			detailAtlasTextures:
				bucketPlan.bucket === "terrain-detail"
					? bucketPlan.detailAtlasTextures
					: [],
			detailAtlasEntryRecords:
				bucketPlan.bucket === "terrain-detail"
					? bucketPlan.detailAtlasEntryRecords
					: [],
		}))
		.filter(
			(bucketPlan) =>
				bucketPlan.atlasTextures.length > 0 ||
				bucketPlan.detailAtlasTextures.length > 0,
		);
	if (terrainBuckets.length === 0) {
		return null;
	}
	const cpuSet = profileBrowserJsScope(
		"webgl2.resource.buildTerrainTexturePagesCpu",
		() =>
			createTexturePageCpuSet({
				plan: {
					key: describeWebgl2TexturePageSetKey({
						planKey: `${plan.key}/terrain-pages`,
						textureFilteringMode,
						maxAnisotropy,
					}),
					rgbaAtlasReadyCandidateIds: ["terrain-texture-pages"],
					detailAtlasTextures: terrainBuckets.flatMap(
						(bucketPlan) => bucketPlan.detailAtlasTextures,
					),
					buckets: terrainBuckets,
					preparedTextureAssetIds: [],
				},
				textureFilteringMode,
				maxAnisotropy,
			}),
	);
	if (!cpuSet) {
		throw new Error(
			`Terrain texture page build ${plan.key} produced no CPU page set for terrain page buckets.`,
		);
	}
	return { cpuSet };
}

function clearWebgl2TerrainTexturePageResources(
	texturePagesByKey: Map<string, Webgl2TerrainTexturePageResource>,
): void {
	for (const texturePage of texturePagesByKey.values()) {
		texturePage.texture.dispose();
	}
	texturePagesByKey.clear();
}
