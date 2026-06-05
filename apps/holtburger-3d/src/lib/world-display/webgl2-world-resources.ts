import type {
	AssetChannelState,
	PreparedTexturePayload,
} from "../assets/types";
import { profileBrowserJsScope } from "../diagnostics/browser-js-profiler";
import { resolveNormalizedPreparedTextureAssetIds } from "../assets/material-texture-preparation-policy";
import { formatHex32 } from "../landblocks";
import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2Texture2D,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2Texture2DResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import {
	buildStagedWorldSceneAssembly,
	describeStagedWorldAssemblyGraphRecordSignature,
	uniqueSortedStrings,
	type StagedWorldAssemblyGraphRecord,
	type StagedWorldDrawUnitAssembly,
} from "./staged-world-assembly";
import type { StagedWorldIndexedGeometry } from "./staged-world-geometry";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type {
	IndexedMaterialDataCache,
	ResolvedIndexedMaterialData,
} from "./indexed-material-data";
import type { StagedWorldMaterialPlanCache } from "./staged-world-materials";
import {
	resolveRegionDetailOverlayPlan,
	type ResolvedRegionDetailOverlayPlan,
} from "./region-detail-overlays";
import {
	createTranslationMat4,
	type RenderMat4,
	type RenderVec4,
} from "./render-math";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import {
	materialDecisionGraphNodeKey,
	atlasGenerationGraphNodeKey,
	preparedAssetGraphNodeKey,
	sceneObjectGraphNodeKey,
	type RendererResourceGraph,
	type RendererResourceGraphDependencyReplacement,
	type RendererResourceGraphLease,
	type RendererResourceGraphNode,
} from "./renderer-resource-graph";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import {
	getDetailedLandblockRenderArtifacts,
	getStaticObjectBundleArtifacts,
} from "./landblock-render-product";
import type { StaticObjectBundleArtifact } from "./static-bundle-layer";
import type {
	DirectRenderSurfaceUploadDataType,
	DirectRenderSurfaceUploadFormat,
	DirectRenderSurfaceUploadInternalFormat,
	MaterialTextureCapabilities,
	RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import { prepareRenderSurfaceTextureUploadData } from "./render-surface-texture-data";
import { isBase1ClipMapSurface } from "./material-behavior";
import {
	createEmptyStructuredInteriorSceneModel,
	type StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";
import {
	buildTransitionPortalMaskDrawUnitAssemblies,
	type TransitionPortalMaskDrawUnitAssembly,
} from "./transition-portal-mask-draw-units";
import {
	createDefaultMaterialTextureSamplingPolicy,
	describeTextureSamplingPolicy,
	selectRenderSurfaceTextureSamplingPolicy,
	type TextureSamplingPolicy,
	type TextureFilteringMode,
} from "./texture-pages/texture-sampling-policy";
import { type StagedWorldMaterialTexturePageReadiness } from "./staged-world-material-strategy";
import {
	createCompactionEligibility,
	createEmptyCompactionFamilyPlan,
	planCompactionFamilies,
	type CompactionEligibility,
	type IndexedPalettedFamilyMaterialTableRecord,
	type RgbaTexturePageDetailAtlasEntry,
	type CompactionFamilyPlan,
	type CompactionFamilyPlanningPolicy,
} from "./compaction/compaction-family-planner";
import {
	createEmptyTexturePageAtlasPlan,
	createTexturePageDetailAtlasPlacementsByEntryKey,
	createTexturePageAtlasPlacementsByEntryKey,
	type TexturePageAtlasDetailCandidate,
	type TexturePageAtlasRgbaCandidate,
	type TexturePageAtlasPlan,
} from "./texture-pages/texture-page-atlas-planner";
import {
	createEmptyIndexedResourceAtlasPlan,
	planIndexedResourceAtlas,
	type IndexedResourceAtlasPlan,
	type IndexedTexelAtlasCandidate,
	type IndexedPaletteAtlasCandidate,
} from "./texture-pages/indexed-resource-atlas-planner";
import {
	deriveDirectGeometrySubmissionLayout,
	type GeometrySubmissionLayout,
} from "./webgl2/families/direct-render-family";
import {
	createWebgl2TextureAtlasGenerationResourceFromCpu,
	describeWebgl2TextureAtlasGenerationKey,
	type Webgl2TextureAtlasGenerationResource,
} from "./webgl2/resources/texture-atlas-generation";
import {
	createWebgl2IndexedResourceAtlasGenerationResourceFromCpu,
	describeWebgl2IndexedResourceAtlasGenerationKey,
	type Webgl2IndexedResourceAtlasGenerationResource,
} from "./webgl2/resources/indexed-resource-atlas-generation";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2CompactedGeometryFamilyResource,
} from "./webgl2/resources/compacted-geometry-resources";
import {
	releaseWebgl2CompactedGeometryBatchGraphLeases,
	syncWebgl2CompactedGeometryResources,
} from "./webgl2/resources/compacted-geometry-sync";
import type {
	CompactedGeometryWorkerScheduler,
	CompactedGeometryWorkerSchedulerMetrics,
} from "./worker-resources/compacted-geometry-worker-scheduler";
import type {
	IndexedResourceAtlasWorkerScheduler,
	IndexedResourceAtlasWorkerSchedulerMetrics,
} from "./worker-resources/indexed-atlas-worker-scheduler";
import type {
	TextureAtlasWorkerScheduler,
	TextureAtlasWorkerSchedulerMetrics,
} from "./worker-resources/texture-atlas-worker-scheduler";
import {
	buildTerrainBlendPlanSet,
	type TerrainBlendTextureRef,
} from "./terrain-blend-plan";
import type {
	LandblockTerrainRenderArtifact,
	TerrainRenderDrawSliceArtifact,
	TerrainRenderTexturePageRef,
} from "./terrain-render-artifact";
import {
	buildTerrainTileDrawSlicePlans,
	buildTerrainTileFallbackGeometry,
	buildTerrainTileLayerGeometry,
	buildTerrainTileLayerPlan,
	type TerrainTileDrawSlicePlan,
	type TerrainTileLayerEntry,
	type TerrainTileLayerGeometry,
	type TerrainTileLayerPlan,
} from "./terrain-tile-plan";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";
import {
	collectDirectDrawTexturePageBindings,
	resolveDirectDrawBaseTexturePageBinding,
	type TexturePageDescriptor,
} from "./texture-pages/texture-page-binding";
import { deriveTerrainTileBatchBvhBinding } from "./non-instanced-bvh-bindings";
import {
	createBlockedTerrainTileOneDrawReadiness,
	describeTerrainBlendTextureAtlasEntryKey,
	describeTerrainTileGeometrySignature,
	describeTerrainTileGraphSignature,
	deriveTerrainTileRenderCandidate,
	deriveTerrainTileOneDrawReadiness,
	deriveTerrainDrawSliceOneDrawReadiness,
	destroyWebgl2TerrainTileDrawSlice,
	destroyWebgl2TerrainTileResource,
	terrainTileResourceId,
	type Webgl2TerrainTileTexturePageBinding,
	type Webgl2TerrainTileDetailPlan,
	type Webgl2TerrainTileDrawSliceResource,
	type Webgl2TerrainTileRenderCandidate,
	type Webgl2TerrainTileResource,
	type Webgl2TerrainTileReadiness,
} from "./webgl2/resources/terrain-tile-resources";
import {
	createWebgl2StaticBundleLayerResourceStore,
	destroyWebgl2StaticBundleLayerResources,
	syncWebgl2StaticBundleLayerResources,
	type Webgl2StaticBundleLayerResourceStore,
} from "./webgl2/resources/static-bundle-layer-resources";
import {
	createWebgl2StructuredInteriorResourceStore,
	destroyWebgl2StructuredInteriorResources,
	syncWebgl2StructuredInteriorResources,
	type Webgl2StructuredInteriorResourceStore,
} from "./webgl2/resources/structured-interior-resources";

type Webgl2DrawUnitAssembly =
	| StagedWorldDrawUnitAssembly
	| TransitionPortalMaskDrawUnitAssembly;

export interface Webgl2WorldDrawUnit {
	id: string;
	kind: Webgl2DrawUnitAssembly["kind"];
	owningLandblockId: number | null;
	geometrySignature: string;
	submitOrderKey: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource | null;
	directGeometryLayout: GeometrySubmissionLayout;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	color: RenderVec4;
	materialKind: Webgl2DrawUnitAssembly["material"]["kind"];
	materialKey: string;
	materialFallbackReason: string | null;
	materialBehavior: LegacyMaterialBehaviorDto | null;
	directTextureSamplingPolicy: TextureSamplingPolicy | null;
	textureUploadSample: string | null;
	texturePageReadiness: StagedWorldMaterialTexturePageReadiness | null;
	compactionEligibility: CompactionEligibility;
	textureKey: string | null;
	texture: Webgl2Texture2DResource | null;
	indexedMaterialDescriptor: Webgl2IndexedMaterialDescriptor | null;
	directIndexedMaterialResources: Webgl2DirectIndexedMaterialResources | null;
	detailOverlay: Webgl2DetailOverlayResources | null;
	texturePageBindings: readonly TexturePageDescriptor[];
	texturePageBindingFallbackSamples: readonly string[];
	sceneDomain: Webgl2SceneDomain | null;
	modelMatrix: RenderMat4;
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

export interface Webgl2WorldResourceStore {
	drawUnits: Webgl2WorldDrawUnit[];
	drawUnitsById: Map<string, Webgl2WorldDrawUnit>;
	terrainTiles: Webgl2TerrainTileResource[];
	terrainTilesById: Map<string, Webgl2TerrainTileResource>;
	terrainRenderCandidates: Webgl2TerrainTileRenderCandidate[];
	staticBundleLayerResources: Webgl2StaticBundleLayerResourceStore;
	structuredInteriorResources: Webgl2StructuredInteriorResourceStore;
	staticBundleLayerResourceCount: number;
	structuredInteriorResourceCount: number;
	structuredInteriorResourceTriangleCount: number;
	staticBundleLayerCompactedBatchResourceCount: number;
	staticBundleLayerDirectEntryResourceCount: number;
	staticBundleLayerTexturePageResourceCount: number;
	graphLeasesByDrawUnitId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByDrawUnitId: Map<string, string>;
	graphLeasesByTerrainTileId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByTerrainTileId: Map<string, string>;
	boundGraph: RendererResourceGraph | null;
	terrainTileCount: number;
	terrainDrawUnitCount: number;
	structuredInteriorDrawUnitCount: number;
	staticDrawUnitCount: number;
	stagedStaticObjectCount: number;
	stagedStaticPartCount: number;
	staticInstanceCount: number;
	materialCount: number;
	directTextureDrawUnitCount: number;
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
	atlasCompatibleDrawUnitCount: number;
	atlasPlacedRgbaDrawUnitCount: number;
	detailAtlasReadyDrawUnitCount: number;
	atlasFailureReasonCount: number;
	atlasFailureSamples: readonly string[];
	compactionFamilyPlan: CompactionFamilyPlan;
	texturePageAtlasPlan: TexturePageAtlasPlan;
	textureAtlasGeneration: Webgl2TextureAtlasGenerationResource | null;
	pendingTextureAtlasGenerationKey: string | null;
	textureAtlasWorkerScheduler: TextureAtlasWorkerScheduler | null;
	textureAtlasWorkerMetrics: TextureAtlasWorkerSchedulerMetrics;
	textureAtlasGenerationGraph: RendererResourceGraph | null;
	textureAtlasGenerationGraphLease: RendererResourceGraphLease | null;
	compactedGeometryBatches: Map<string, Webgl2CompactedGeometryBatchResource>;
	pendingCompactedGeometryBatchKeys: Set<string>;
	compactedGeometryBatchKeyBySchedulerKey: Map<string, string>;
	compactedGeometryFamilyResourceKeyBySchedulerKey: Map<string, string>;
	compactedGeometryWorkerScheduler: CompactedGeometryWorkerScheduler | null;
	compactedGeometryWorkerMetrics: CompactedGeometryWorkerSchedulerMetrics;
	compactedGeometryFamilyResources: Map<
		string,
		Webgl2CompactedGeometryFamilyResource
	>;
	compactedGeometryFamilyResourceCounts: Record<string, number>;
	compactedGeometryBatchGraph: RendererResourceGraph | null;
	compactedGeometryBatchGraphLeasesByKey: Map<
		string,
		RendererResourceGraphLease
	>;
	compactionCandidateDrawUnitCount: number;
	compactionBypassReasonCount: number;
	compactionBypassSamples: readonly string[];
	compactionBypassBlockerSamples: readonly string[];
	compactionBypassDetailSamples: readonly string[];
	compactionCoverageDrawUnitCounts: Record<string, number>;
	compactionCoverageMaterialBlockerCounts: Record<string, number>;
	compactionCoverageGeometryBlockerCounts: Record<string, number>;
	compactionCoverageMaterialFamilyCounts: Record<string, number>;
	compactionCoverageMaterialAlphaPolicyCounts: Record<string, number>;
	compactionCoverageMaterialFamilyAlphaPolicyCounts: Record<string, number>;
	compactionCoverageRetainedDirectMaterialFamilyCounts: Record<string, number>;
	compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts: Record<
		string,
		number
	>;
	indexedResourceAtlasPlan: IndexedResourceAtlasPlan;
	indexedResourceAtlasGeneration: Webgl2IndexedResourceAtlasGenerationResource | null;
	pendingIndexedResourceAtlasGenerationKey: string | null;
	indexedResourceAtlasWorkerScheduler: IndexedResourceAtlasWorkerScheduler | null;
	indexedResourceAtlasWorkerMetrics: IndexedResourceAtlasWorkerSchedulerMetrics;
	indexedResourceAtlasGenerationGraph: RendererResourceGraph | null;
	indexedResourceAtlasGenerationGraphLease: RendererResourceGraphLease | null;
	textureAtlasGenerationTextureCount: number;
	detailTextureAtlasGenerationTextureCount: number;
	indexedMaterialDescriptorDrawUnitCount: number;
	indexedMaterialDescriptorCompactionCandidateCount: number;
	standaloneIndexedMaterialResourceDrawUnitCount: number;
	compactedIndexedMaterialStandaloneResourceDrawUnitCount: number;
	indexedResourceAtlasCandidateDrawUnitCount: number;
	indexedResourceAtlasIndexTextureCount: number;
	indexedResourceAtlasPaletteTextureCount: number;
	indexedResourceAtlasFailureReasonCount: number;
	indexedResourceAtlasFailureSamples: readonly string[];
	compactedGeometryBatchCount: number;
	compactedGeometryDrawUnitCount: number;
	compactedGeometryTriangleCount: number;
	compactedGeometryVertexByteLength: number;
	compactedGeometryIndexByteLength: number;
	compactedGeometryTotalByteLength: number;
	compactedGeometryDrawSliceCount: number;
	compactedGeometryBatchOriginCount: number;
	compactedGeometryTransformTableEntryCount: number;
	compactedResourceFallbackSamples: readonly string[];
	textureCount: number;
	indexedTextureCount: number;
	paletteTextureCount: number;
	detailTextureCount: number;
	preparedTextureUploadCount: number;
	preparedTextureGeneratedByteLength: number;
	triangleCount: number;
	texturesByKey: Map<string, Webgl2Texture2DResource>;
	indexedMaterialDataCache: IndexedMaterialDataCache;
	materialPlanCache: StagedWorldMaterialPlanCache;
}

export interface Webgl2DetailOverlayResources {
	key: string;
	texture: Webgl2Texture2DResource;
	tiling: number;
	blendMode: ResolvedRegionDetailOverlayPlan["blendMode"];
	atlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface Webgl2IndexedMaterialDescriptor {
	key: string;
	indexFormat: ResolvedIndexedMaterialData["texture"]["format"];
	indexTextureKey: string;
	paletteTextureKey: string;
	width: number;
	height: number;
	indexSourceBytes: Uint8Array;
	paletteColorCount: number;
	paletteRgbaBytes: Uint8Array;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
	clipThreshold: number;
}

export interface Webgl2DirectIndexedMaterialResources {
	descriptor: Webgl2IndexedMaterialDescriptor;
	indexTexture: Webgl2Texture2DResource;
	paletteTexture: Webgl2Texture2DResource;
}

const warnedUnsupportedDetailAtlasTextureKeys = new Set<string>();

export function createWebgl2WorldResourceStore(): Webgl2WorldResourceStore {
	return {
		drawUnits: [],
		drawUnitsById: new Map(),
		terrainTiles: [],
		terrainTilesById: new Map(),
		terrainRenderCandidates: [],
		staticBundleLayerResources: createWebgl2StaticBundleLayerResourceStore(),
		structuredInteriorResources: createWebgl2StructuredInteriorResourceStore(),
		staticBundleLayerResourceCount: 0,
		structuredInteriorResourceCount: 0,
		structuredInteriorResourceTriangleCount: 0,
		staticBundleLayerCompactedBatchResourceCount: 0,
		staticBundleLayerDirectEntryResourceCount: 0,
		staticBundleLayerTexturePageResourceCount: 0,
		graphLeasesByDrawUnitId: new Map(),
		graphSignaturesByDrawUnitId: new Map(),
		graphLeasesByTerrainTileId: new Map(),
		graphSignaturesByTerrainTileId: new Map(),
		boundGraph: null,
		terrainTileCount: 0,
		terrainDrawUnitCount: 0,
		structuredInteriorDrawUnitCount: 0,
		staticDrawUnitCount: 0,
		stagedStaticObjectCount: 0,
		stagedStaticPartCount: 0,
		staticInstanceCount: 0,
		materialCount: 0,
		directTextureDrawUnitCount: 0,
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
		atlasCompatibleDrawUnitCount: 0,
		atlasPlacedRgbaDrawUnitCount: 0,
		detailAtlasReadyDrawUnitCount: 0,
		atlasFailureReasonCount: 0,
		atlasFailureSamples: [],
		compactionFamilyPlan: createEmptyCompactionFamilyPlan(),
		texturePageAtlasPlan: createEmptyTexturePageAtlasPlan(),
		textureAtlasGeneration: null,
		pendingTextureAtlasGenerationKey: null,
		textureAtlasWorkerScheduler: null,
		textureAtlasWorkerMetrics: createEmptyTextureAtlasWorkerSchedulerMetrics(),
		textureAtlasGenerationGraph: null,
		textureAtlasGenerationGraphLease: null,
		compactedGeometryBatches: new Map(),
		pendingCompactedGeometryBatchKeys: new Set(),
		compactedGeometryBatchKeyBySchedulerKey: new Map(),
		compactedGeometryFamilyResourceKeyBySchedulerKey: new Map(),
		compactedGeometryWorkerScheduler: null,
		compactedGeometryWorkerMetrics:
			createEmptyCompactedGeometryWorkerSchedulerMetrics(),
		compactedGeometryFamilyResources: new Map(),
		compactedGeometryFamilyResourceCounts: {},
		compactedGeometryBatchGraph: null,
		compactedGeometryBatchGraphLeasesByKey: new Map(),
		compactionCandidateDrawUnitCount: 0,
		compactionBypassReasonCount: 0,
		compactionBypassSamples: [],
		compactionBypassBlockerSamples: [],
		compactionBypassDetailSamples: [],
		compactionCoverageDrawUnitCounts: {},
		compactionCoverageMaterialBlockerCounts: {},
		compactionCoverageGeometryBlockerCounts: {},
		compactionCoverageMaterialFamilyCounts: {},
		compactionCoverageMaterialAlphaPolicyCounts: {},
		compactionCoverageMaterialFamilyAlphaPolicyCounts: {},
		compactionCoverageRetainedDirectMaterialFamilyCounts: {},
		compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts: {},
		indexedResourceAtlasPlan: createEmptyIndexedResourceAtlasPlan(),
		indexedResourceAtlasGeneration: null,
		pendingIndexedResourceAtlasGenerationKey: null,
		indexedResourceAtlasWorkerScheduler: null,
		indexedResourceAtlasWorkerMetrics:
			createEmptyIndexedResourceAtlasWorkerSchedulerMetrics(),
		indexedResourceAtlasGenerationGraph: null,
		indexedResourceAtlasGenerationGraphLease: null,
		textureAtlasGenerationTextureCount: 0,
		detailTextureAtlasGenerationTextureCount: 0,
		indexedMaterialDescriptorDrawUnitCount: 0,
		indexedMaterialDescriptorCompactionCandidateCount: 0,
		standaloneIndexedMaterialResourceDrawUnitCount: 0,
		compactedIndexedMaterialStandaloneResourceDrawUnitCount: 0,
		indexedResourceAtlasCandidateDrawUnitCount: 0,
		indexedResourceAtlasIndexTextureCount: 0,
		indexedResourceAtlasPaletteTextureCount: 0,
		indexedResourceAtlasFailureReasonCount: 0,
		indexedResourceAtlasFailureSamples: [],
		compactedGeometryBatchCount: 0,
		compactedGeometryDrawUnitCount: 0,
		compactedGeometryTriangleCount: 0,
		compactedGeometryVertexByteLength: 0,
		compactedGeometryIndexByteLength: 0,
		compactedGeometryTotalByteLength: 0,
		compactedGeometryDrawSliceCount: 0,
		compactedGeometryBatchOriginCount: 0,
		compactedGeometryTransformTableEntryCount: 0,
		compactedResourceFallbackSamples: [],
		textureCount: 0,
		indexedTextureCount: 0,
		paletteTextureCount: 0,
		detailTextureCount: 0,
		preparedTextureUploadCount: 0,
		preparedTextureGeneratedByteLength: 0,
		triangleCount: 0,
		texturesByKey: new Map(),
		indexedMaterialDataCache: new Map(),
		materialPlanCache: new Map(),
	};
}

export function syncWebgl2StaticLandblockRenderArtifactResources({
	gl,
	store,
	artifacts,
	renderChunkTransforms = [],
	textureFilteringMode = "anisotropic-4x",
	maxAnisotropy = 1,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	artifacts: StaticLandblockRenderArtifactStoreSnapshot;
	renderChunkTransforms?: readonly RenderChunkTransform[];
	textureFilteringMode?: TextureFilteringMode;
	maxAnisotropy?: number;
}): void {
	const layers = artifacts.artifacts.flatMap((artifact) =>
		getStaticObjectBundleArtifacts(artifact).filter((bundle) =>
			isRenderableStaticLandblockArtifactLayer(
				artifact.product,
				bundle.bundleKind,
			),
		),
	);
	syncWebgl2StaticBundleLayerResources({
		gl,
		store: store.staticBundleLayerResources,
		layers,
		textureFilteringMode,
		maxAnisotropy,
	});
	const detailedArtifacts = artifacts.artifacts
		.map(getDetailedLandblockRenderArtifacts)
		.filter((artifact): artifact is NonNullable<typeof artifact> =>
			Boolean(artifact),
		);
	syncWebgl2StructuredInteriorResources({
		gl,
		store: store.structuredInteriorResources,
		artifacts: detailedArtifacts,
		renderChunkTransforms,
		textureFilteringMode,
		maxAnisotropy,
	});
	const resources = [...store.staticBundleLayerResources.layersByKey.values()];
	store.staticBundleLayerResourceCount = resources.length;
	const structuredInteriorResources = [
		...store.structuredInteriorResources.cellsByKey.values(),
	];
	store.structuredInteriorResourceCount = structuredInteriorResources.length;
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

function isRenderableStaticLandblockArtifactLayer(
	product: StaticLandblockRenderArtifactStoreSnapshot["artifacts"][number]["product"],
	bundleKind: StaticObjectBundleArtifact["bundleKind"],
): boolean {
	switch (product) {
		case "outdoor":
			return (
				bundleKind === "outdoor-buildings" || bundleKind === "outdoor-detail"
			);
		case "outdoor-env-cells":
		case "dungeon-env-cells":
			return bundleKind === "env-cell-static";
	}
}

export function markWebgl2TextureAtlasGenerationReplacementPending({
	store,
	generationKey,
}: {
	store: Webgl2WorldResourceStore;
	generationKey: string;
}): void {
	if (store.textureAtlasGeneration?.key === generationKey) {
		store.pendingTextureAtlasGenerationKey = null;
		return;
	}
	store.pendingTextureAtlasGenerationKey = generationKey;
}

export function commitWebgl2TextureAtlasGeneration({
	store,
	generation,
}: {
	store: Webgl2WorldResourceStore;
	generation: Webgl2TextureAtlasGenerationResource;
}): void {
	const previousGeneration = store.textureAtlasGeneration;
	if (previousGeneration !== generation) {
		previousGeneration?.dispose();
	}
	store.textureAtlasGeneration = generation;
	store.pendingTextureAtlasGenerationKey = null;
}

export function markWebgl2IndexedResourceAtlasGenerationReplacementPending({
	store,
	generationKey,
}: {
	store: Webgl2WorldResourceStore;
	generationKey: string;
}): void {
	if (store.indexedResourceAtlasGeneration?.key === generationKey) {
		store.pendingIndexedResourceAtlasGenerationKey = null;
		return;
	}
	store.pendingIndexedResourceAtlasGenerationKey = generationKey;
}

export function commitWebgl2IndexedResourceAtlasGeneration({
	store,
	generation,
}: {
	store: Webgl2WorldResourceStore;
	generation: Webgl2IndexedResourceAtlasGenerationResource;
}): void {
	const previousGeneration = store.indexedResourceAtlasGeneration;
	if (previousGeneration !== generation) {
		previousGeneration?.dispose();
	}
	store.indexedResourceAtlasGeneration = generation;
	store.pendingIndexedResourceAtlasGenerationKey = null;
}

export function markWebgl2CompactedGeometryBatchReplacementPending({
	store,
	batchKey,
}: {
	store: Webgl2WorldResourceStore;
	batchKey: string;
}): void {
	store.pendingCompactedGeometryBatchKeys.add(batchKey);
}

export function syncWebgl2WorldResources({
	gl,
	store,
	assetState,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	transitionPortalModel,
	renderChunkTransforms,
	rendererResourceGraph,
	materialTextureCapabilities = defaultWebgl2MaterialTextureCapabilities(),
	textureFilteringMode = "anisotropic-4x",
	detailTexturesEnabled = true,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	rendererResourceGraph?: RendererResourceGraph;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
}): void {
	// ELEMENT_ARRAY_BUFFER binding is VAO state in WebGL2. Resource sync creates
	// and clears index buffers, so start from the default VAO to avoid stripping
	// the index buffer from whichever draw-unit VAO the previous frame left bound.
	gl.bindVertexArray(null);
	const assembly = profileBrowserJsScope(
		"webgl2.resource.buildStagedWorldSceneAssembly",
		() =>
			buildStagedWorldSceneAssembly({
				assetState,
				terrainScene,
				staticRenderableScene,
				structuredInteriorScene:
					store.structuredInteriorResourceCount > 0
						? createEmptyStructuredInteriorSceneModel()
						: structuredInteriorScene,
				renderChunkTransforms,
				materialTextureCapabilities,
				textureFilteringMode,
				detailTexturesEnabled,
				indexedMaterialDataCache: store.indexedMaterialDataCache,
				materialPlanCache: store.materialPlanCache,
				excludedStaticLandblockIds:
					deriveResidentOutdoorStaticBundleLandblockIds(store),
			}),
	);
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const portalMaskDrawUnits = profileBrowserJsScope(
		"webgl2.resource.buildTransitionPortalMaskDrawUnits",
		() =>
			buildTransitionPortalMaskDrawUnitAssemblies({
				chunkOffsetByKey,
				transitionPortalModel,
			}),
	);
	const nextDrawUnits: Webgl2WorldDrawUnit[] = [];
	const nextTerrainTiles: Webgl2TerrainTileResource[] = [];
	const retainedDrawUnitIds = new Set<string>();
	const retainedTerrainTileIds = new Set<string>();
	const retainedTextureKeys = new Set<string>();
	profileBrowserJsScope("webgl2.resource.createOrReuseTerrainTiles", () => {
		for (const tile of terrainScene.tiles) {
			const terrainTile = createOrReuseWebgl2TerrainTile({
				assetState,
				chunkOffsetByKey,
				gl,
				store,
				tile,
				retainedTerrainTileIds,
			});
			if (!terrainTile) {
				continue;
			}
			nextTerrainTiles.push(terrainTile);
		}
	});
	profileBrowserJsScope("webgl2.resource.createOrReuseDrawUnits", () => {
		for (const drawUnit of [...assembly.drawUnits, ...portalMaskDrawUnits]) {
			const webgl2DrawUnit = createOrReuseWebgl2DrawUnit({
				assetState,
				gl,
				store,
				drawUnit,
				retainedDrawUnitIds,
				materialTextureCapabilities,
				textureFilteringMode,
				uploadIndexedMaterialResources: false,
			});
			nextDrawUnits.push(webgl2DrawUnit);
			if (webgl2DrawUnit.textureKey) {
				retainedTextureKeys.add(webgl2DrawUnit.textureKey);
			}
			if (webgl2DrawUnit.detailOverlay) {
				retainedTextureKeys.add(webgl2DrawUnit.detailOverlay.key);
			}
		}
	});

	for (const [terrainTileId, terrainTile] of store.terrainTilesById) {
		if (!retainedTerrainTileIds.has(terrainTileId)) {
			destroyWebgl2TerrainTileResource(terrainTile);
			store.terrainTilesById.delete(terrainTileId);
		}
	}

	for (const [drawUnitId, drawUnit] of store.drawUnitsById) {
		if (!retainedDrawUnitIds.has(drawUnitId)) {
			destroyWebgl2DrawUnit(drawUnit);
			store.drawUnitsById.delete(drawUnitId);
		}
	}

	store.drawUnits = nextDrawUnits;
	store.terrainTiles = nextTerrainTiles;
	store.terrainRenderCandidates = store.terrainTiles.map(
		deriveTerrainTileRenderCandidate,
	);
	store.terrainTileCount = store.terrainTiles.length;
	store.terrainDrawUnitCount = 0;
	store.structuredInteriorDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.kind === "structured-interior",
	).length;
	store.staticDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.kind === "static",
	).length;
	store.stagedStaticObjectCount = countUniqueStaticObjectKeys(store.drawUnits);
	store.stagedStaticPartCount = countUniqueBvhItemKeys(
		store.drawUnits.filter((drawUnit) =>
			drawUnit.id.startsWith("static-staged/"),
		),
	);
	store.staticInstanceCount = countUniqueBvhItemKeys(
		store.drawUnits.filter((drawUnit) => drawUnit.kind === "static"),
	);
	store.materialCount = new Set(
		store.drawUnits.map((drawUnit) => drawUnit.materialKey),
	).size;
	store.directTextureDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.materialKind === "direct-texture",
	).length;
	const materialFallbackReasons = store.drawUnits.flatMap((drawUnit) =>
		drawUnit.materialFallbackReason ? [drawUnit.materialFallbackReason] : [],
	);
	store.materialFallbackReasonCount = materialFallbackReasons.length;
	store.materialFallbackReasonSamples = summarizeDiagnosticReasons(
		materialFallbackReasons,
		8,
	);
	const textureSamplingPolicies = collectTextureSamplingPolicySamples(
		store.drawUnits,
	);
	store.textureSamplingPolicyCounts = countStringOccurrences(
		textureSamplingPolicies,
	);
	const texturePageBindings = store.drawUnits.flatMap((drawUnit) => [
		...drawUnit.texturePageBindings,
	]);
	store.texturePageBindingCount = texturePageBindings.length;
	store.texturePageUsageBucketCounts = countStringOccurrences(
		texturePageBindings.map((binding) => binding.usageBucket),
	);
	store.texturePageSampleClassCounts = countStringOccurrences(
		texturePageBindings.map((binding) => binding.sampleClass),
	);
	const texturePageReadyDrawUnits = store.drawUnits.filter(
		(drawUnit) => drawUnit.texturePageReadiness !== null,
	);
	store.texturePageReadyMaterialCount = texturePageReadyDrawUnits.length;
	store.atlasCandidateEntryCount = new Set(
		texturePageReadyDrawUnits.flatMap((drawUnit) =>
			drawUnit.texturePageReadiness
				? [drawUnit.texturePageReadiness.atlasEntryKey]
				: [],
		),
	).size;
	store.atlasCandidateMaterialSlotCount = new Set(
		texturePageReadyDrawUnits.flatMap((drawUnit) =>
			drawUnit.texturePageReadiness
				? [drawUnit.texturePageReadiness.materialSlotKey]
				: [],
		),
	).size;
	store.compactionFamilyPlan = profileBrowserJsScope(
		"webgl2.resource.planCompactionFamilies",
		() => {
			const terrainPageCandidates = collectTerrainTexturePageAtlasCandidates({
				assetState,
				terrainTiles: store.terrainTiles,
				materialTextureCapabilities,
				textureFilteringMode,
				detailTexturesEnabled,
				reportDiagnostic: (message) => {
					store.materialFallbackReasonSamples = [
						...store.materialFallbackReasonSamples,
						message,
					].slice(0, 8);
				},
			});
			store.terrainAtlasRefCount = terrainPageCandidates.refCount;
			store.terrainAtlasCandidateCount =
				terrainPageCandidates.rgbaCandidates.length;
			store.terrainAtlasBlockerTileCount =
				terrainPageCandidates.blockersByTerrainTileId.size;
			applyTerrainTexturePageBlockers({
				terrainTiles: store.terrainTiles,
				blockersByTerrainTileId: terrainPageCandidates.blockersByTerrainTileId,
			});
			return planCompactionFamilies({
				drawUnits: store.drawUnits.map(toCompactionFamilyCandidate),
				policy: DEFAULT_WEBGL2_COMPACTION_FAMILY_PLANNING_POLICY,
				extraRgbaAtlasCandidates: terrainPageCandidates.rgbaCandidates,
				extraDetailAtlasCandidates: terrainPageCandidates.detailCandidates,
			});
		},
	);
	store.texturePageAtlasPlan = store.compactionFamilyPlan.texturePageAtlasPlan;
	store.atlasCompatibleDrawUnitCount = texturePageReadyDrawUnits.length;
	store.atlasPlacedRgbaDrawUnitCount =
		store.texturePageAtlasPlan.rgbaAtlasReadyDrawUnitIds.length;
	store.detailAtlasReadyDrawUnitCount =
		store.texturePageAtlasPlan.detailAtlasReadyDrawUnitIds.length;
	store.atlasFailureReasonCount = store.texturePageAtlasPlan.failures.length;
	store.atlasFailureSamples = summarizeDiagnosticReasons(
		store.texturePageAtlasPlan.failures.map((failure) => failure.reason),
		8,
	);
	store.compactionCandidateDrawUnitCount =
		store.compactionFamilyPlan.renderFamilies.rgbaTexturePage.compactableDrawUnitIds.length;
	store.compactionBypassReasonCount =
		store.compactionFamilyPlan.bypasses.length;
	store.compactionBypassSamples = summarizeDiagnosticReasons(
		store.compactionFamilyPlan.bypasses.map((bypass) => bypass.reason),
		8,
	);
	const drawUnitById = new Map(
		store.drawUnits.map((drawUnit) => [drawUnit.id, drawUnit] as const),
	);
	store.compactionBypassBlockerSamples = summarizeDiagnosticReasons(
		store.compactionFamilyPlan.bypasses.map((bypass) =>
			describeCompactionBypassBlockerSample(bypass, drawUnitById),
		),
		8,
	);
	store.compactionBypassDetailSamples = summarizeDiagnosticReasons(
		store.compactionFamilyPlan.bypasses.map(
			(bypass) => `${bypass.reason}: ${bypass.detail}`,
		),
		8,
	);
	const compactionCoverageMetrics = collectCompactionCoverageMetrics(
		store.drawUnits,
	);
	store.compactionCoverageDrawUnitCounts =
		compactionCoverageMetrics.drawUnitCounts;
	store.compactionCoverageMaterialBlockerCounts =
		compactionCoverageMetrics.materialBlockerCounts;
	store.compactionCoverageGeometryBlockerCounts =
		compactionCoverageMetrics.geometryBlockerCounts;
	store.compactionCoverageMaterialFamilyCounts =
		compactionCoverageMetrics.materialFamilyCounts;
	store.compactionCoverageMaterialAlphaPolicyCounts =
		compactionCoverageMetrics.materialAlphaPolicyCounts;
	store.compactionCoverageMaterialFamilyAlphaPolicyCounts =
		compactionCoverageMetrics.materialFamilyAlphaPolicyCounts;
	store.compactionCoverageRetainedDirectMaterialFamilyCounts =
		compactionCoverageMetrics.retainedDirectMaterialFamilyCounts;
	store.compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts =
		compactionCoverageMetrics.retainedDirectMaterialFamilyAlphaPolicyCounts;
	store.indexedMaterialDescriptorDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.indexedMaterialDescriptor !== null,
	).length;
	const compactedIndexedDrawUnitIds = new Set(
		store.compactionFamilyPlan.renderFamilies.indexedPaletted
			.compactableDrawUnitIds,
	);
	store.indexedMaterialDescriptorCompactionCandidateCount =
		store.drawUnits.filter(
			(drawUnit) =>
				drawUnit.indexedMaterialDescriptor !== null &&
				compactedIndexedDrawUnitIds.has(drawUnit.id),
		).length;
	store.indexedResourceAtlasPlan =
		planIndexedResourceAtlasForCompactedDrawUnits({
			drawUnits: store.drawUnits,
			compactedIndexedDrawUnitIds,
			policy: DEFAULT_WEBGL2_COMPACTION_FAMILY_PLANNING_POLICY,
		});
	store.indexedResourceAtlasCandidateDrawUnitCount =
		store.indexedMaterialDescriptorCompactionCandidateCount;
	store.indexedResourceAtlasFailureReasonCount =
		store.indexedResourceAtlasPlan.failures.length;
	store.indexedResourceAtlasFailureSamples = summarizeDiagnosticReasons(
		store.indexedResourceAtlasPlan.failures.map(
			(failure) => `${failure.reason}:${failure.detail}`,
		),
		8,
	);
	const atlasPlacedCompactedIndexedDrawUnitIds =
		collectAtlasPlacedCompactedIndexedDrawUnitIds({
			compactedIndexedDrawUnitIds,
			plan: store.indexedResourceAtlasPlan,
		});
	syncWebgl2DirectIndexedMaterialResources({
		gl,
		store,
		stagedDrawUnits: assembly.drawUnits,
		retainedDirectIndexedDrawUnitIds: collectRetainedDirectIndexedDrawUnitIds({
			drawUnits: store.drawUnits,
			atlasPlacedCompactedIndexedDrawUnitIds,
		}),
	});
	store.standaloneIndexedMaterialResourceDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.directIndexedMaterialResources !== null,
	).length;
	store.compactedIndexedMaterialStandaloneResourceDrawUnitCount =
		store.drawUnits.filter(
			(drawUnit) =>
				drawUnit.directIndexedMaterialResources !== null &&
				compactedIndexedDrawUnitIds.has(drawUnit.id),
		).length;
	for (const drawUnit of store.drawUnits) {
		for (const textureKey of collectDirectIndexedMaterialTextureKeys(
			drawUnit,
		)) {
			retainedTextureKeys.add(textureKey);
		}
	}
	syncWebgl2TextureAtlasGeneration({
		gl,
		store,
		plan: store.texturePageAtlasPlan,
		textureFilteringMode,
		maxAnisotropy: materialTextureCapabilities.maxAnisotropy ?? 1,
		rendererResourceGraph,
	});
	syncWebgl2IndexedResourceAtlasGeneration({
		gl,
		store,
		plan: store.indexedResourceAtlasPlan,
		rendererResourceGraph,
	});
	resolveWebgl2TerrainTileTexturePageBindings({ gl, store });
	resolveWebgl2DrawUnitTexturePageBindings(store);
	for (const [textureKey, texture] of store.texturesByKey) {
		if (!retainedTextureKeys.has(textureKey)) {
			texture.dispose();
			store.texturesByKey.delete(textureKey);
		}
	}
	store.textureCount = store.texturesByKey.size;
	store.indexedTextureCount = new Set(
		store.drawUnits.flatMap((drawUnit) =>
			drawUnit.directIndexedMaterialResources
				? [drawUnit.directIndexedMaterialResources.descriptor.indexTextureKey]
				: [],
		),
	).size;
	store.paletteTextureCount = new Set(
		store.drawUnits.flatMap((drawUnit) =>
			drawUnit.directIndexedMaterialResources
				? [drawUnit.directIndexedMaterialResources.descriptor.paletteTextureKey]
				: [],
		),
	).size;
	store.detailTextureCount = new Set(
		store.drawUnits.flatMap((drawUnit) =>
			drawUnit.detailOverlay ? [drawUnit.detailOverlay.key] : [],
		),
	).size;
	store.preparedTextureUploadCount = countPreparedTextureUploads(
		store.drawUnits,
	);
	store.preparedTextureGeneratedByteLength = 0;
	store.triangleCount = store.drawUnits.reduce(
		(total, drawUnit) => total + drawUnit.triangleCount,
		0,
	);
	syncWebgl2AssemblyGraph({
		graph: rendererResourceGraph,
		store,
		records: assembly.graphRecords,
		retainedDrawUnitIds,
	});
	syncWebgl2TerrainTileGraph({
		graph: rendererResourceGraph,
		store,
		retainedTerrainTileIds,
	});
	syncWebgl2CompactedGeometryResources({
		gl,
		store,
		plan: store.compactionFamilyPlan,
		drawUnits: assembly.drawUnits,
		renderChunkTransforms,
		rendererResourceGraph,
		indexedResourceAtlasPlan: store.indexedResourceAtlasPlan,
	});
}

export function destroyWebgl2WorldResources(
	store: Webgl2WorldResourceStore,
): void {
	if (store.boundGraph) {
		for (const lease of store.graphLeasesByDrawUnitId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		for (const lease of store.graphLeasesByTerrainTileId.values()) {
			store.boundGraph.releaseLease(lease);
		}
	}
	releaseWebgl2TextureAtlasGenerationGraphLease(store);
	releaseWebgl2CompactedGeometryBatchGraphLeases(store);
	for (const drawUnit of store.drawUnits) {
		destroyWebgl2DrawUnit(drawUnit);
	}
	for (const terrainTile of store.terrainTiles) {
		destroyWebgl2TerrainTileResource(terrainTile);
	}
	destroyWebgl2StaticBundleLayerResources(store.staticBundleLayerResources);
	destroyWebgl2StructuredInteriorResources(store.structuredInteriorResources);
	store.drawUnits = [];
	store.drawUnitsById.clear();
	store.terrainTiles = [];
	store.terrainTilesById.clear();
	store.terrainRenderCandidates = [];
	store.staticBundleLayerResourceCount = 0;
	store.structuredInteriorResourceCount = 0;
	store.structuredInteriorResourceTriangleCount = 0;
	store.staticBundleLayerCompactedBatchResourceCount = 0;
	store.staticBundleLayerDirectEntryResourceCount = 0;
	store.staticBundleLayerTexturePageResourceCount = 0;
	store.graphLeasesByDrawUnitId.clear();
	store.graphSignaturesByDrawUnitId.clear();
	store.graphLeasesByTerrainTileId.clear();
	store.graphSignaturesByTerrainTileId.clear();
	releaseWebgl2TextureAtlasGenerationGraphLease(store);
	releaseWebgl2IndexedResourceAtlasGenerationGraphLease(store);
	store.textureAtlasWorkerScheduler?.dispose();
	store.textureAtlasWorkerScheduler = null;
	store.textureAtlasWorkerMetrics =
		createEmptyTextureAtlasWorkerSchedulerMetrics();
	store.compactedGeometryWorkerScheduler?.dispose();
	store.compactedGeometryWorkerScheduler = null;
	store.compactedGeometryWorkerMetrics =
		createEmptyCompactedGeometryWorkerSchedulerMetrics();
	store.indexedResourceAtlasWorkerScheduler?.dispose();
	store.indexedResourceAtlasWorkerScheduler = null;
	store.indexedResourceAtlasWorkerMetrics =
		createEmptyIndexedResourceAtlasWorkerSchedulerMetrics();
	store.textureAtlasGenerationGraph = null;
	store.textureAtlasGenerationGraphLease = null;
	store.indexedResourceAtlasGenerationGraph = null;
	store.indexedResourceAtlasGenerationGraphLease = null;
	store.compactedGeometryBatchGraph = null;
	store.compactedGeometryBatchGraphLeasesByKey.clear();
	store.compactedGeometryBatchKeyBySchedulerKey.clear();
	store.compactedGeometryFamilyResourceKeyBySchedulerKey.clear();
	store.pendingCompactedGeometryBatchKeys.clear();
	store.boundGraph = null;
	store.terrainTileCount = 0;
	store.terrainDrawUnitCount = 0;
	store.structuredInteriorDrawUnitCount = 0;
	store.staticDrawUnitCount = 0;
	store.stagedStaticObjectCount = 0;
	store.stagedStaticPartCount = 0;
	store.staticInstanceCount = 0;
	store.materialCount = 0;
	store.directTextureDrawUnitCount = 0;
	store.materialFallbackReasonCount = 0;
	store.materialFallbackReasonSamples = [];
	store.textureSamplingPolicyCounts = {};
	store.texturePageBindingCount = 0;
	store.texturePageUsageBucketCounts = {};
	store.texturePageSampleClassCounts = {};
	store.texturePageReadyMaterialCount = 0;
	store.atlasCandidateEntryCount = 0;
	store.atlasCandidateMaterialSlotCount = 0;
	store.atlasCompatibleDrawUnitCount = 0;
	store.atlasPlacedRgbaDrawUnitCount = 0;
	store.detailAtlasReadyDrawUnitCount = 0;
	store.atlasFailureReasonCount = 0;
	store.atlasFailureSamples = [];
	store.compactionFamilyPlan = createEmptyCompactionFamilyPlan();
	store.texturePageAtlasPlan = createEmptyTexturePageAtlasPlan();
	store.textureAtlasGeneration?.dispose();
	store.textureAtlasGeneration = null;
	store.pendingTextureAtlasGenerationKey = null;
	store.textureAtlasWorkerMetrics =
		createEmptyTextureAtlasWorkerSchedulerMetrics();
	for (const batch of store.compactedGeometryBatches.values()) {
		batch.dispose();
	}
	store.compactedGeometryBatches.clear();
	store.pendingCompactedGeometryBatchKeys.clear();
	store.compactedGeometryFamilyResources.clear();
	store.compactedGeometryFamilyResourceCounts = {};
	store.compactionCandidateDrawUnitCount = 0;
	store.compactionBypassReasonCount = 0;
	store.compactionBypassSamples = [];
	store.compactionBypassBlockerSamples = [];
	store.compactionBypassDetailSamples = [];
	store.compactionCoverageDrawUnitCounts = {};
	store.compactionCoverageMaterialBlockerCounts = {};
	store.compactionCoverageGeometryBlockerCounts = {};
	store.compactionCoverageMaterialFamilyCounts = {};
	store.compactionCoverageMaterialAlphaPolicyCounts = {};
	store.compactionCoverageMaterialFamilyAlphaPolicyCounts = {};
	store.compactionCoverageRetainedDirectMaterialFamilyCounts = {};
	store.compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts = {};
	store.indexedResourceAtlasPlan = createEmptyIndexedResourceAtlasPlan();
	store.indexedResourceAtlasGeneration?.dispose();
	store.indexedResourceAtlasGeneration = null;
	store.pendingIndexedResourceAtlasGenerationKey = null;
	store.indexedResourceAtlasWorkerMetrics =
		createEmptyIndexedResourceAtlasWorkerSchedulerMetrics();
	store.indexedMaterialDescriptorDrawUnitCount = 0;
	store.indexedMaterialDescriptorCompactionCandidateCount = 0;
	store.standaloneIndexedMaterialResourceDrawUnitCount = 0;
	store.compactedIndexedMaterialStandaloneResourceDrawUnitCount = 0;
	store.indexedResourceAtlasCandidateDrawUnitCount = 0;
	store.indexedResourceAtlasIndexTextureCount = 0;
	store.indexedResourceAtlasPaletteTextureCount = 0;
	store.indexedResourceAtlasFailureReasonCount = 0;
	store.indexedResourceAtlasFailureSamples = [];
	store.textureAtlasGenerationTextureCount = 0;
	store.detailTextureAtlasGenerationTextureCount = 0;
	store.compactedGeometryBatchCount = 0;
	store.compactedGeometryDrawUnitCount = 0;
	store.compactedGeometryTriangleCount = 0;
	store.compactedGeometryVertexByteLength = 0;
	store.compactedGeometryIndexByteLength = 0;
	store.compactedGeometryTotalByteLength = 0;
	store.compactedGeometryDrawSliceCount = 0;
	store.compactedGeometryBatchOriginCount = 0;
	store.compactedGeometryTransformTableEntryCount = 0;
	store.compactedResourceFallbackSamples = [];
	for (const texture of store.texturesByKey.values()) {
		texture.dispose();
	}
	store.texturesByKey.clear();
	store.indexedMaterialDataCache.clear();
	store.materialPlanCache.clear();
	store.textureCount = 0;
	store.indexedTextureCount = 0;
	store.paletteTextureCount = 0;
	store.detailTextureCount = 0;
	store.preparedTextureUploadCount = 0;
	store.preparedTextureGeneratedByteLength = 0;
	store.triangleCount = 0;
}

function deriveResidentOutdoorStaticBundleLandblockIds(
	store: Webgl2WorldResourceStore,
): ReadonlySet<number> {
	const bundleKindsByLandblockId = new Map<number, Set<string>>();
	for (const layer of store.staticBundleLayerResources.layersByKey.values()) {
		if (
			layer.bundleKind !== "outdoor-buildings" &&
			layer.bundleKind !== "outdoor-detail"
		) {
			continue;
		}
		const bundleKinds = bundleKindsByLandblockId.get(layer.landblockId);
		if (bundleKinds) {
			bundleKinds.add(layer.bundleKind);
		} else {
			bundleKindsByLandblockId.set(
				layer.landblockId,
				new Set([layer.bundleKind]),
			);
		}
	}
	const landblockIds = new Set<number>();
	for (const [landblockId, bundleKinds] of bundleKindsByLandblockId) {
		if (
			bundleKinds.has("outdoor-buildings") &&
			bundleKinds.has("outdoor-detail")
		) {
			landblockIds.add(landblockId);
		}
	}
	return landblockIds;
}

function createEmptyCompactedGeometryWorkerSchedulerMetrics(): CompactedGeometryWorkerSchedulerMetrics {
	return {
		activeSchedulerCount: 0,
		submittedJobCount: 0,
		dedupedDesiredJobCount: 0,
		coalescedDesiredJobCount: 0,
		staleResultCount: 0,
		readyResultCount: 0,
		committedResultCount: 0,
		errorCount: 0,
		lastStaleDiscardReason: null,
		lastErrorMessage: null,
	};
}

function createEmptyIndexedResourceAtlasWorkerSchedulerMetrics(): IndexedResourceAtlasWorkerSchedulerMetrics {
	return {
		activeSchedulerCount: 0,
		submittedJobCount: 0,
		dedupedDesiredJobCount: 0,
		coalescedDesiredJobCount: 0,
		staleResultCount: 0,
		readyResultCount: 0,
		committedResultCount: 0,
		errorCount: 0,
		lastStaleDiscardReason: null,
		lastErrorMessage: null,
	};
}

function createEmptyTextureAtlasWorkerSchedulerMetrics(): TextureAtlasWorkerSchedulerMetrics {
	return {
		activeSchedulerCount: 0,
		submittedJobCount: 0,
		dedupedDesiredJobCount: 0,
		coalescedDesiredJobCount: 0,
		staleResultCount: 0,
		readyResultCount: 0,
		committedResultCount: 0,
		errorCount: 0,
		lastStaleDiscardReason: null,
		lastErrorMessage: null,
	};
}

const DEFAULT_WEBGL2_COMPACTION_FAMILY_PLANNING_POLICY: CompactionFamilyPlanningPolicy =
	{
		maxAtlasTextureSize: 4096,
		maxAtlasTextureCount: 8,
		baseGutterPixels: 2,
		maxMaterialSlotsPerDraw: 128,
	};

function createOrReuseWebgl2TerrainTile({
	assetState,
	chunkOffsetByKey,
	gl,
	store,
	tile,
	retainedTerrainTileIds,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	tile: TerrainSceneModel["tiles"][number];
	retainedTerrainTileIds: Set<string>;
}): Webgl2TerrainTileResource | null {
	const placement = deriveLandblockRenderChunkPlacement(tile.landblockId);
	const chunkOffset = chunkOffsetByKey.get(placement.chunkKey);
	if (!chunkOffset) {
		return null;
	}
	const id = terrainTileResourceId(tile);
	const uploadPlan = createTerrainTileUploadPlan({
		assetState,
		gl,
		id,
		modelMatrix: createTranslationMat4({
			x: chunkOffset.x + tile.chunkLocalOffset.x,
			y: chunkOffset.y + tile.chunkLocalOffset.y,
			z: chunkOffset.z + tile.chunkLocalOffset.z,
		}),
		tile,
	});
	if (uploadPlan.geometry.triangleCount === 0) {
		return null;
	}
	const bvhBinding = deriveTerrainTileBatchBvhBinding(tile);
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
		for (const slice of previous.drawSlices) {
			destroyWebgl2TerrainTileDrawSlice(slice);
		}
		previous.label = tile.label;
		previous.regionNumber = tile.materialResources.regionNumber;
		previous.placementKey = placement.chunkKey;
		previous.modelMatrix = uploadPlan.modelMatrix;
		previous.readiness = uploadPlan.readiness;
		previous.dataSource = tile.dataSource;
		previous.mesh = tile.mesh;
		previous.bvhItemKeys = [...bvhBinding.itemKeys];
		previous.bvhFallbackReason = bvhBinding.fallbackReason;
		previous.drawSlices = uploadPlan.drawSlices;
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
		retainedTerrainTileIds.add(id);
		return previous;
	}
	if (previous) {
		destroyWebgl2TerrainTileResource(previous);
	}
	const buffers = createWebgl2IndexedGeometryBuffers(gl, {
		id,
		geometry: uploadPlan.geometry,
	});
	const resource = {
		id,
		assetId: tile.assetId,
		landblockId: tile.landblockId,
		regionNumber: tile.materialResources.regionNumber,
		label: tile.label,
		placementKey: placement.chunkKey,
		geometrySignature,
		...buffers,
		vertexCount: uploadPlan.geometry.indices.length,
		triangleCount: uploadPlan.geometry.triangleCount,
		modelMatrix: uploadPlan.modelMatrix,
		readiness: uploadPlan.readiness,
		dataSource: tile.dataSource,
		mesh: tile.mesh,
		bvhItemKeys: [...bvhBinding.itemKeys],
		bvhFallbackReason: bvhBinding.fallbackReason,
		drawSlices: uploadPlan.drawSlices,
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
	retainedTerrainTileIds.add(id);
	return resource;
}

function createTerrainTileUploadPlan({
	assetState,
	gl,
	id,
	modelMatrix,
	tile,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	id: string;
	modelMatrix: RenderMat4;
	tile: TerrainSceneModel["tiles"][number];
}): {
	readiness: Webgl2TerrainTileReadiness;
	modelMatrix: RenderMat4;
	geometry: StagedWorldIndexedGeometry | TerrainTileLayerGeometry;
	layerPlan: TerrainTileLayerPlan | null;
	layerPlanBlockers: readonly string[];
	drawSlices: Webgl2TerrainTileDrawSliceResource[];
	terrainArtifactTexturePageRefs: readonly TerrainRenderTexturePageRef[];
} {
	if (tile.terrainArtifact) {
		return createTerrainArtifactUploadPlan({
			gl,
			id,
			modelMatrix,
			tile,
			artifact: tile.terrainArtifact,
		});
	}

	const readiness = deriveWebgl2TerrainTileReadiness(tile);
	const planSet = resolveTerrainBlendPlanSetForTile({
		assetState,
		tile,
	});
	const layerPlan = buildTerrainTileLayerPlan({ planSet });
	const drawSlicePlans = buildTerrainTileDrawSlicePlans({ planSet }).filter(
		(slice) => layerPlan?.blockers.length || slice.id !== "slice/0",
	);
	const layerGeometry =
		layerPlan && layerPlan.blockers.length === 0
			? buildTerrainTileLayerGeometry({ mesh: tile.mesh, plan: layerPlan })
			: null;
	const drawSlices = drawSlicePlans.flatMap((slicePlan) =>
		createWebgl2TerrainTileDrawSlice({
			gl,
			id: `${id}/${slicePlan.id}`,
			modelMatrix,
			parentTerrainTileId: id,
			reason: slicePlan.reason,
			mesh: tile.mesh,
			slicePlan,
		}),
	);
	return {
		readiness,
		modelMatrix,
		geometry: layerGeometry ?? buildTerrainTileFallbackGeometry(tile.mesh),
		layerPlan,
		layerPlanBlockers: collectTerrainTileLayerPlanBlockers({
			readiness,
			planSet,
			layerPlan,
		}),
		drawSlices,
		terrainArtifactTexturePageRefs: [],
	};
}

function createTerrainArtifactUploadPlan({
	gl,
	id,
	modelMatrix,
	tile,
	artifact,
}: {
	gl: WebGL2RenderingContext;
	id: string;
	modelMatrix: RenderMat4;
	tile: TerrainSceneModel["tiles"][number];
	artifact: LandblockTerrainRenderArtifact;
}): ReturnType<typeof createTerrainTileUploadPlan> {
	const readiness = deriveWebgl2TerrainTileReadiness(tile);
	const oneDrawSlice =
		artifact.drawSlices.length === 1 &&
		artifact.drawSlices[0]?.slicePlan.layerPlan.blockers.length === 0
			? artifact.drawSlices[0]
			: null;
	const drawSlices = oneDrawSlice
		? []
		: artifact.drawSlices.flatMap((slice) =>
				createWebgl2TerrainTileDrawSliceFromArtifact({
					gl,
					id: `${id}/${slice.slicePlan.id}`,
					modelMatrix,
					parentTerrainTileId: id,
					mesh: tile.mesh,
					slice,
				}),
			);
	const fallbackBlockers =
		artifact.diagnostics.fallbackReasons.length > 0
			? artifact.diagnostics.fallbackReasons
			: ["terrain artifact did not emit a one-draw layer plan"];
	return {
		readiness,
		modelMatrix,
		geometry: oneDrawSlice?.geometry ?? artifact.debugFallbackGeometry,
		layerPlan: oneDrawSlice?.slicePlan.layerPlan ?? artifact.layerPlan,
		layerPlanBlockers:
			oneDrawSlice?.slicePlan.layerPlan.blockers ??
			artifact.layerPlan?.blockers ??
			fallbackBlockers,
		drawSlices,
		terrainArtifactTexturePageRefs: artifact.texturePageRefs,
	};
}

function createWebgl2TerrainTileDrawSlice({
	gl,
	id,
	modelMatrix,
	parentTerrainTileId,
	reason,
	mesh,
	slicePlan,
}: {
	gl: WebGL2RenderingContext;
	id: string;
	modelMatrix: RenderMat4;
	parentTerrainTileId: string;
	reason: string;
	mesh: TerrainSceneModel["tiles"][number]["mesh"];
	slicePlan: TerrainTileDrawSlicePlan;
}): Webgl2TerrainTileDrawSliceResource[] {
	const geometry = buildTerrainTileLayerGeometry({
		mesh,
		plan: slicePlan.layerPlan,
	});
	if (geometry.triangleCount === 0) {
		return [];
	}
	const buffers = createWebgl2IndexedGeometryBuffers(gl, {
		id,
		geometry,
	});
	if (!buffers.uvBuffer || !buffers.layerSlotBuffer) {
		throw new Error(
			`Terrain draw slice ${id} was created without layer geometry buffers.`,
		);
	}
	const bvhItemKeys = deriveTerrainDrawSliceBvhItemKeys({ mesh, slicePlan });
	return [
		{
			id,
			parentTerrainTileId,
			reason,
			geometrySignature: describeTerrainTileGeometrySignature(geometry),
			...buffers,
			uvBuffer: buffers.uvBuffer,
			layerSlotBuffer: buffers.layerSlotBuffer,
			vertexCount: geometry.indices.length,
			triangleCount: geometry.triangleCount,
			modelMatrix,
			bvhItemKeys,
			layerPlan: slicePlan.layerPlan,
			detailPlan: null,
			texturePageBindings: [],
			texturePageBlockers: [],
			oneDrawReadiness: createBlockedTerrainTileOneDrawReadiness([
				"terrain draw slice texture page bindings are unresolved",
			]),
		},
	];
}

function createWebgl2TerrainTileDrawSliceFromArtifact({
	gl,
	id,
	modelMatrix,
	parentTerrainTileId,
	mesh,
	slice,
}: {
	gl: WebGL2RenderingContext;
	id: string;
	modelMatrix: RenderMat4;
	parentTerrainTileId: string;
	mesh: TerrainSceneModel["tiles"][number]["mesh"];
	slice: TerrainRenderDrawSliceArtifact;
}): Webgl2TerrainTileDrawSliceResource[] {
	if (slice.geometry.triangleCount === 0) {
		return [];
	}
	const buffers = createWebgl2IndexedGeometryBuffers(gl, {
		id,
		geometry: slice.geometry,
	});
	if (!buffers.uvBuffer || !buffers.layerSlotBuffer) {
		throw new Error(
			`Terrain artifact draw slice ${id} was created without layer geometry buffers.`,
		);
	}
	return [
		{
			id,
			parentTerrainTileId,
			reason: slice.slicePlan.reason,
			geometrySignature: describeTerrainTileGeometrySignature(slice.geometry),
			...buffers,
			uvBuffer: buffers.uvBuffer,
			layerSlotBuffer: buffers.layerSlotBuffer,
			vertexCount: slice.geometry.indices.length,
			triangleCount: slice.geometry.triangleCount,
			modelMatrix,
			bvhItemKeys: deriveTerrainDrawSliceBvhItemKeys({
				mesh,
				slicePlan: slice.slicePlan,
			}),
			layerPlan: slice.slicePlan.layerPlan,
			detailPlan: null,
			texturePageBindings: [],
			texturePageBlockers: [],
			oneDrawReadiness: createBlockedTerrainTileOneDrawReadiness([
				"terrain draw slice texture page bindings are unresolved",
			]),
		},
	];
}

function deriveTerrainDrawSliceBvhItemKeys({
	mesh,
	slicePlan,
}: {
	mesh: TerrainSceneModel["tiles"][number]["mesh"];
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

function resolveTerrainBlendPlanSetForTile({
	assetState,
	tile,
}: {
	assetState: AssetChannelState;
	tile: TerrainSceneModel["tiles"][number];
}): ReturnType<typeof buildTerrainBlendPlanSet> {
	return tile.materialResources.status === "ready"
		? buildTerrainBlendPlanSet({
				assetState,
				regionNumber: tile.materialResources.regionNumber,
				pcodes: tile.mesh.quads.map((quad) => quad.pcode),
			})
		: null;
}

function collectTerrainTileLayerPlanBlockers({
	readiness,
	planSet,
	layerPlan,
}: {
	readiness: Webgl2TerrainTileReadiness;
	planSet: ReturnType<typeof resolveTerrainBlendPlanSetForTile>;
	layerPlan: TerrainTileLayerPlan | null;
}): readonly string[] {
	if (readiness.status !== "ready") {
		return [readiness.reason];
	}
	if (!planSet) {
		return ["terrain blend plan set is unavailable"];
	}
	if (!layerPlan) {
		return ["terrain layer plan is unavailable"];
	}
	return layerPlan.blockers;
}

function createWebgl2IndexedGeometryBuffers(
	gl: WebGL2RenderingContext,
	{
		id,
		geometry,
	}: {
		id: string;
		geometry: StagedWorldIndexedGeometry | TerrainTileLayerGeometry;
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

function deriveWebgl2TerrainTileReadiness(
	tile: TerrainSceneModel["tiles"][number],
): Webgl2TerrainTileReadiness {
	if (tile.materialResources.status === "ready") {
		return {
			status: "ready",
			terrainMaterialAssetId: tile.materialResources.terrainMaterialAssetId,
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
	assetState,
	terrainTiles,
	materialTextureCapabilities,
	textureFilteringMode,
	detailTexturesEnabled,
	reportDiagnostic,
}: {
	assetState: AssetChannelState;
	terrainTiles: readonly Webgl2TerrainTileResource[];
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	detailTexturesEnabled: boolean;
	reportDiagnostic?: (message: string) => void;
}): {
	rgbaCandidates: TexturePageAtlasRgbaCandidate[];
	detailCandidates: TexturePageAtlasDetailCandidate[];
	blockersByTerrainTileId: ReadonlyMap<string, readonly string[]>;
	refCount: number;
} {
	const rgbaCandidates: TexturePageAtlasRgbaCandidate[] = [];
	const detailCandidates: TexturePageAtlasDetailCandidate[] = [];
	const blockersByTerrainTileId = new Map<string, string[]>();
	let refCount = 0;
	for (const tile of terrainTiles) {
		tile.detailPlan = null;
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
				assetState,
				ref,
				tile,
				blockersByTerrainTileId,
			});
			if (!readiness) {
				continue;
			}
			rgbaCandidates.push({
				drawUnitId: tile.id,
				family: ref.role === "mask" ? "terrain-mask" : "terrain-color",
				texturePageReadiness: readiness,
				detailAtlasEntry: null,
			});
		}
		if (
			detailTexturesEnabled &&
			tile.terrainArtifactTexturePageRefs.length === 0
		) {
			const detailPlan = resolveTerrainTileDetailPlan({
				assetState,
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
		blockersByTerrainTileId,
		refCount,
	};
}

function resolveTerrainTileDetailPlan({
	assetState,
	tile,
	materialTextureCapabilities,
	textureFilteringMode,
	reportDiagnostic,
}: {
	assetState: AssetChannelState;
	tile: Webgl2TerrainTileResource;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	reportDiagnostic?: (message: string) => void;
}): {
	plan: Webgl2TerrainTileDetailPlan;
	candidate: TexturePageAtlasDetailCandidate | null;
} | null {
	const overlay = resolveRegionDetailOverlayPlan({
		assetState,
		regionNumber: tile.regionNumber,
		roleKind: "landscape",
		reportDiagnostic,
	});
	if (!overlay) {
		return null;
	}
	const upload = prepareTerrainDetailTextureUpload({
		assetState,
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
					drawUnitId: tile.id,
					family: "terrain-detail",
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
	assetState,
	overlay,
	materialTextureCapabilities,
	textureFilteringMode,
	reportDiagnostic,
}: {
	assetState: AssetChannelState;
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
			assetState,
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

function createTerrainTexturePageReadiness({
	assetState,
	ref,
	tile,
	blockersByTerrainTileId,
}: {
	assetState: AssetChannelState;
	ref: TerrainBlendTextureRef;
	tile: Webgl2TerrainTileResource;
	blockersByTerrainTileId: Map<string, string[]>;
}): StagedWorldMaterialTexturePageReadiness | null {
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
		assetState,
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
}): StagedWorldMaterialTexturePageReadiness | null {
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
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
}): void {
	const placementsByEntryKey = createTexturePageAtlasPlacementsByEntryKey(
		store.texturePageAtlasPlan,
	);
	const detailPlacementsByEntryKey =
		createTexturePageDetailAtlasPlacementsByEntryKey(
			store.texturePageAtlasPlan,
		);
	for (const tile of store.terrainTiles) {
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
			bindings.push({
				family: ref.role === "mask" ? "terrain-mask" : "terrain-color",
				atlasEntryKey,
				textureIndex: placement.textureIndex,
				rect: [placement.x, placement.y, placement.width, placement.height],
			});
		}
		if (tile.detailPlan) {
			const placement =
				detailPlacementsByEntryKey.get(tile.detailPlan.atlasEntryKey) ?? null;
			if (placement) {
				bindings.push({
					family: "terrain-detail",
					atlasEntryKey: tile.detailPlan.atlasEntryKey,
					textureIndex: placement.textureIndex,
					rect: [placement.x, placement.y, placement.width, placement.height],
				});
			} else {
				store.materialFallbackReasonSamples = [
					...store.materialFallbackReasonSamples,
					`missing terrain detail atlas placement ${tile.detailPlan.atlasEntryKey}`,
				].slice(0, 8);
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
		return createWebgl2TerrainTileDrawSlice({
			gl,
			id: `${tile.id}/page-slice/${groupIndex}`,
			modelMatrix: tile.modelMatrix,
			parentTerrainTileId: tile.id,
			reason: group.reason,
			mesh: tile.mesh,
			slicePlan: {
				id: `page-slice/${groupIndex}`,
				reason: group.reason,
				layerPlan: sliceLayerPlan,
				pcodes: group.entries.map((entry) => entry.pcode),
			},
		});
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
				[`${binding.family}/${binding.atlasEntryKey}`, binding] as const,
		),
	);
	return [...bindingByKey.values()].sort((left, right) =>
		`${left.family}/${left.atlasEntryKey}`.localeCompare(
			`${right.family}/${right.atlasEntryKey}`,
		),
	);
}

function createOrReuseWebgl2DrawUnit({
	assetState,
	gl,
	store,
	drawUnit,
	retainedDrawUnitIds,
	materialTextureCapabilities,
	textureFilteringMode,
	uploadIndexedMaterialResources,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: Webgl2DrawUnitAssembly;
	retainedDrawUnitIds: Set<string>;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
	uploadIndexedMaterialResources: boolean;
}): Webgl2WorldDrawUnit {
	const geometrySignature = createGeometrySignature(drawUnit);
	const previous = store.drawUnitsById.get(drawUnit.id);
	if (previous && previous.geometrySignature === geometrySignature) {
		previous.color = drawUnit.material.color;
		previous.owningLandblockId = resolveAtlasCompactionLandblockId(drawUnit);
		previous.materialKind = drawUnit.material.kind;
		previous.materialKey = drawUnit.material.key;
		previous.submitOrderKey = describeWebgl2DrawUnitSubmitOrderKey(
			drawUnit,
			geometrySignature,
		);
		previous.materialFallbackReason =
			resolveWebgl2MaterialFallbackReason(drawUnit);
		previous.materialBehavior = drawUnit.material.behavior;
		previous.directTextureSamplingPolicy =
			resolveWebgl2DrawUnitDirectTextureSamplingPolicy(drawUnit);
		previous.textureUploadSample =
			resolveWebgl2DrawUnitTextureUploadSample(drawUnit);
		previous.texturePageReadiness =
			resolveWebgl2DrawUnitTexturePageReadiness(drawUnit);
		previous.textureKey =
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.textureKey
				: drawUnit.material.kind === "indexed-paletted"
					? drawUnit.material.indexedMaterial.renderSurfaceAssetId
					: null;
		previous.texture = resolveWebgl2DrawUnitTexture({ gl, store, drawUnit });
		previous.indexedMaterialDescriptor =
			resolveWebgl2IndexedMaterialDescriptor(drawUnit);
		previous.directIndexedMaterialResources = uploadIndexedMaterialResources
			? resolveWebgl2DirectIndexedMaterialResources({
					gl,
					store,
					drawUnit,
					descriptor: previous.indexedMaterialDescriptor,
				})
			: null;
		previous.detailOverlay = resolveWebgl2DetailOverlayResources({
			assetState,
			gl,
			store,
			drawUnit,
			materialTextureCapabilities,
			textureFilteringMode,
		});
		previous.texturePageBindings = collectDirectDrawTexturePageBindings({
			texture: previous.texture,
			directIndexedMaterialResources: previous.directIndexedMaterialResources,
			indexedMaterialDescriptor: previous.indexedMaterialDescriptor,
			detailOverlay: previous.detailOverlay,
			directTextureSamplingPolicy: previous.directTextureSamplingPolicy,
			texturePageReadiness: previous.texturePageReadiness,
		});
		previous.texturePageBindingFallbackSamples = [];
		previous.directGeometryLayout =
			deriveDirectGeometrySubmissionLayout(previous);
		previous.compactionEligibility = createCompactionEligibility({
			geometry: {
				kind: previous.kind,
				owningLandblockId: previous.owningLandblockId,
				hasUvBuffer: previous.uvBuffer !== null,
			},
			material: {
				kind: previous.materialKind,
				behavior: previous.materialBehavior,
				texturePages: {
					base: previous.texturePageReadiness,
					bindings: previous.texturePageBindings,
				},
				detailOverlay: {
					hasOverlay: previous.detailOverlay !== null,
					atlasEntry: previous.detailOverlay?.atlasEntry ?? null,
				},
			},
		});
		previous.sceneDomain = deriveWebgl2DrawUnitSceneDomain(drawUnit);
		previous.modelMatrix = drawUnit.modelMatrix;
		previous.bvhItemKeys = drawUnit.bvhBinding.itemKeys;
		previous.bvhFallbackReason = drawUnit.bvhBinding.fallbackReason;
		previous.staticPartCount = drawUnit.staticPartCount;
		previous.staticObjectKeys = [...drawUnit.staticObjectKeys];
		retainedDrawUnitIds.add(drawUnit.id);
		return previous;
	}
	if (previous) {
		destroyWebgl2DrawUnit(previous);
	}

	const vertexBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${drawUnit.id}/positions`,
		data: drawUnit.geometry.positions,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${drawUnit.id}/indices`,
		data: drawUnit.geometry.indices,
	});
	const uvBuffer =
		(drawUnit.material.kind === "direct-texture" ||
			drawUnit.material.kind === "indexed-paletted") &&
		drawUnit.geometry.uvs
			? createWebgl2ArrayBuffer(gl, {
					label: `${drawUnit.id}/uvs`,
					data: drawUnit.geometry.uvs,
				})
			: null;
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${drawUnit.id}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			if (uvBuffer) {
				gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer.buffer);
				gl.enableVertexAttribArray(1);
				gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
			}
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	const texture = resolveWebgl2DrawUnitTexture({ gl, store, drawUnit });
	const indexedMaterialDescriptor =
		resolveWebgl2IndexedMaterialDescriptor(drawUnit);
	const directIndexedMaterialResources = uploadIndexedMaterialResources
		? resolveWebgl2DirectIndexedMaterialResources({
				gl,
				store,
				drawUnit,
				descriptor: indexedMaterialDescriptor,
			})
		: null;
	const detailOverlay = resolveWebgl2DetailOverlayResources({
		assetState,
		gl,
		store,
		drawUnit,
		materialTextureCapabilities,
		textureFilteringMode,
	});
	const directTextureSamplingPolicy =
		resolveWebgl2DrawUnitDirectTextureSamplingPolicy(drawUnit);
	const texturePageReadiness =
		resolveWebgl2DrawUnitTexturePageReadiness(drawUnit);
	const texturePageBindings = collectDirectDrawTexturePageBindings({
		texture,
		directIndexedMaterialResources,
		indexedMaterialDescriptor,
		detailOverlay,
		directTextureSamplingPolicy,
		texturePageReadiness,
	});
	const webgl2DrawUnit = {
		id: drawUnit.id,
		kind: drawUnit.kind,
		owningLandblockId: resolveAtlasCompactionLandblockId(drawUnit),
		geometrySignature,
		submitOrderKey: describeWebgl2DrawUnitSubmitOrderKey(
			drawUnit,
			geometrySignature,
		),
		vertexArray,
		vertexBuffer,
		uvBuffer,
		directGeometryLayout: deriveDirectGeometrySubmissionLayout({ uvBuffer }),
		indexBuffer,
		indexType:
			drawUnit.geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		vertexCount: drawUnit.geometry.indices.length,
		triangleCount: drawUnit.geometry.triangleCount,
		color: drawUnit.material.color,
		materialKind: drawUnit.material.kind,
		materialKey: drawUnit.material.key,
		materialFallbackReason: resolveWebgl2MaterialFallbackReason(drawUnit),
		materialBehavior: drawUnit.material.behavior,
		directTextureSamplingPolicy,
		textureUploadSample: resolveWebgl2DrawUnitTextureUploadSample(drawUnit),
		texturePageReadiness,
		compactionEligibility: createCompactionEligibility({
			geometry: {
				kind: drawUnit.kind,
				owningLandblockId: resolveAtlasCompactionLandblockId(drawUnit),
				hasUvBuffer: uvBuffer !== null,
			},
			material: {
				kind: drawUnit.material.kind,
				behavior: drawUnit.material.behavior,
				texturePages: {
					base: texturePageReadiness,
					bindings: texturePageBindings,
				},
				detailOverlay: {
					hasOverlay: detailOverlay !== null,
					atlasEntry: detailOverlay?.atlasEntry ?? null,
				},
			},
		}),
		textureKey:
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.textureKey
				: drawUnit.material.kind === "indexed-paletted"
					? drawUnit.material.indexedMaterial.renderSurfaceAssetId
					: null,
		texture,
		indexedMaterialDescriptor,
		directIndexedMaterialResources,
		detailOverlay,
		texturePageBindings,
		texturePageBindingFallbackSamples: [],
		sceneDomain: deriveWebgl2DrawUnitSceneDomain(drawUnit),
		modelMatrix: drawUnit.modelMatrix,
		bvhItemKeys: drawUnit.bvhBinding.itemKeys,
		bvhFallbackReason: drawUnit.bvhBinding.fallbackReason,
		staticPartCount: drawUnit.staticPartCount,
		staticObjectKeys: [...drawUnit.staticObjectKeys],
	} satisfies Webgl2WorldDrawUnit;
	store.drawUnitsById.set(drawUnit.id, webgl2DrawUnit);
	retainedDrawUnitIds.add(drawUnit.id);
	return webgl2DrawUnit;
}

function describeWebgl2DrawUnitSubmitOrderKey(
	drawUnit: Webgl2DrawUnitAssembly,
	geometrySignature: string,
): string {
	const textureKey =
		drawUnit.material.kind === "direct-texture"
			? drawUnit.material.textureKey
			: drawUnit.material.kind === "indexed-paletted"
				? drawUnit.material.indexedMaterial.renderSurfaceAssetId
				: "";
	const textureRank =
		drawUnit.material.kind === "direct-texture" && drawUnit.geometry.uvs
			? "0"
			: "1";
	return [
		textureRank,
		drawUnit.material.kind,
		drawUnit.material.key,
		textureKey,
		geometrySignature,
		drawUnit.id,
	].join("\0");
}

function deriveWebgl2DrawUnitSceneDomain(
	drawUnit: Webgl2DrawUnitAssembly,
): Webgl2SceneDomain | null {
	switch (drawUnit.kind) {
		case "structured-interior":
			return "interior";
		case "static":
			return drawUnit.renderDomain === WORLD_RENDER_DOMAIN.interiorStatic
				? "interior"
				: "exterior";
		case "portal-mask":
			return null;
	}
}

function resolveAtlasCompactionLandblockId(
	drawUnit: Webgl2DrawUnitAssembly,
): number | null {
	switch (drawUnit.kind) {
		case "static":
		case "structured-interior":
			return drawUnit.owningLandblockId;
		case "portal-mask":
			return null;
	}
}

function toCompactionFamilyCandidate(drawUnit: Webgl2WorldDrawUnit) {
	return {
		id: drawUnit.id,
		kind: drawUnit.kind,
		owningLandblockId: drawUnit.owningLandblockId,
		sceneDomain: drawUnit.sceneDomain,
		visibilityPartitionKey: describeCompactionVisibilityPartition(drawUnit),
		materialKind: drawUnit.materialKind,
		materialKey: drawUnit.materialKey,
		detailAtlasEntry: drawUnit.detailOverlay?.atlasEntry ?? null,
		indexedMaterialTableRecord:
			createIndexedPalettedFamilyMaterialTableRecord(drawUnit),
		compactionEligibility: drawUnit.compactionEligibility,
		triangleCount: drawUnit.triangleCount,
		staticPartCount: drawUnit.staticPartCount,
		staticObjectKeys: drawUnit.staticObjectKeys,
	};
}

function describeCompactionVisibilityPartition(
	drawUnit: Webgl2WorldDrawUnit,
): string {
	const bvhKey =
		drawUnit.bvhItemKeys.length > 0
			? [...drawUnit.bvhItemKeys].sort().join(",")
			: drawUnit.id;
	return [drawUnit.sceneDomain ?? "domain-none", drawUnit.kind, bvhKey].join(
		"|",
	);
}

function createIndexedPalettedFamilyMaterialTableRecord(
	drawUnit: Webgl2WorldDrawUnit,
): IndexedPalettedFamilyMaterialTableRecord | null {
	const descriptor = drawUnit.indexedMaterialDescriptor;
	if (
		!descriptor ||
		drawUnit.compactionEligibility.material.alphaPolicy !== "opaque"
	) {
		return null;
	}
	return {
		key: [
			"compacted-indexed-material",
			drawUnit.materialKey,
			descriptor.indexTextureKey,
			descriptor.paletteTextureKey,
			descriptor.indexFormat,
			`clip=${descriptor.clipThreshold}`,
			`wrap=${descriptor.wrapS}/${descriptor.wrapT}`,
			`detail=${drawUnit.detailOverlay?.atlasEntry?.key ?? "none"}`,
		].join("|"),
		sourceMaterialKey: drawUnit.materialKey,
		indexPageKey: descriptor.indexTextureKey,
		palettePageKey: descriptor.paletteTextureKey,
		indexFormat: descriptor.indexFormat,
		indexPageWidth: descriptor.width,
		indexPageHeight: descriptor.height,
		paletteColorCount: descriptor.paletteColorCount,
		clipThreshold: descriptor.clipThreshold,
		wrapS: descriptor.wrapS,
		wrapT: descriptor.wrapT,
		color: drawUnit.color,
		detailAtlasEntryKey: drawUnit.detailOverlay?.atlasEntry?.key ?? null,
		detailTiling: drawUnit.detailOverlay?.tiling ?? 1,
		alphaPolicy: "opaque",
		filteringMode: "shader-palette-linear",
	};
}

function planIndexedResourceAtlasForCompactedDrawUnits({
	drawUnits,
	compactedIndexedDrawUnitIds,
	policy,
}: {
	drawUnits: readonly Webgl2WorldDrawUnit[];
	compactedIndexedDrawUnitIds: ReadonlySet<string>;
	policy: CompactionFamilyPlanningPolicy;
}): IndexedResourceAtlasPlan {
	const compactedIndexedDrawUnits = drawUnits.filter(
		(drawUnit) =>
			compactedIndexedDrawUnitIds.has(drawUnit.id) &&
			drawUnit.indexedMaterialDescriptor !== null,
	);
	const indexCandidates: IndexedTexelAtlasCandidate[] =
		compactedIndexedDrawUnits.map((drawUnit) => {
			const descriptor = requireIndexedMaterialDescriptor(drawUnit);
			return {
				drawUnitId: drawUnit.id,
				indexTextureKey: descriptor.indexTextureKey,
				format: descriptor.indexFormat,
				width: descriptor.width,
				height: descriptor.height,
				sourceBytes: descriptor.indexSourceBytes,
			};
		});
	const paletteCandidates: IndexedPaletteAtlasCandidate[] =
		compactedIndexedDrawUnits.map((drawUnit) => {
			const descriptor = requireIndexedMaterialDescriptor(drawUnit);
			return {
				drawUnitId: drawUnit.id,
				paletteTextureKey: descriptor.paletteTextureKey,
				colorCount: descriptor.paletteColorCount,
				rgbaBytes: descriptor.paletteRgbaBytes,
			};
		});
	return planIndexedResourceAtlas({
		indexCandidates,
		paletteCandidates,
		policy: {
			maxTextureSize: policy.maxAtlasTextureSize,
			maxTextureCount: policy.maxAtlasTextureCount,
		},
	});
}

function requireIndexedMaterialDescriptor(
	drawUnit: Webgl2WorldDrawUnit,
): Webgl2IndexedMaterialDescriptor {
	const descriptor = drawUnit.indexedMaterialDescriptor;
	if (!descriptor) {
		throw new Error(`Indexed draw unit ${drawUnit.id} has no descriptor.`);
	}
	return descriptor;
}

function collectAtlasPlacedCompactedIndexedDrawUnitIds({
	compactedIndexedDrawUnitIds,
	plan,
}: {
	compactedIndexedDrawUnitIds: ReadonlySet<string>;
	plan: IndexedResourceAtlasPlan;
}): ReadonlySet<string> {
	const indexReadyDrawUnitIds = new Set(plan.indexReadyDrawUnitIds);
	const paletteReadyDrawUnitIds = new Set(plan.paletteReadyDrawUnitIds);
	return new Set(
		[...compactedIndexedDrawUnitIds].filter(
			(drawUnitId) =>
				indexReadyDrawUnitIds.has(drawUnitId) &&
				paletteReadyDrawUnitIds.has(drawUnitId),
		),
	);
}

function collectRetainedDirectIndexedDrawUnitIds({
	drawUnits,
	atlasPlacedCompactedIndexedDrawUnitIds,
}: {
	drawUnits: readonly Webgl2WorldDrawUnit[];
	atlasPlacedCompactedIndexedDrawUnitIds: ReadonlySet<string>;
}): ReadonlySet<string> {
	return new Set(
		drawUnits.flatMap((drawUnit) =>
			drawUnit.indexedMaterialDescriptor &&
			!atlasPlacedCompactedIndexedDrawUnitIds.has(drawUnit.id)
				? [drawUnit.id]
				: [],
		),
	);
}

function syncWebgl2DirectIndexedMaterialResources({
	gl,
	store,
	stagedDrawUnits,
	retainedDirectIndexedDrawUnitIds,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	stagedDrawUnits: readonly StagedWorldDrawUnitAssembly[];
	retainedDirectIndexedDrawUnitIds: ReadonlySet<string>;
}): void {
	const stagedDrawUnitById = new Map(
		stagedDrawUnits.map((drawUnit) => [drawUnit.id, drawUnit] as const),
	);
	for (const drawUnit of store.drawUnits) {
		if (!drawUnit.indexedMaterialDescriptor) {
			drawUnit.directIndexedMaterialResources = null;
			continue;
		}
		const stagedDrawUnit = stagedDrawUnitById.get(drawUnit.id);
		if (!stagedDrawUnit) {
			throw new Error(
				`Cannot sync direct indexed resources for missing staged draw unit ${drawUnit.id}.`,
			);
		}
		drawUnit.directIndexedMaterialResources =
			retainedDirectIndexedDrawUnitIds.has(drawUnit.id)
				? resolveWebgl2DirectIndexedMaterialResources({
						gl,
						store,
						drawUnit: stagedDrawUnit,
						descriptor: drawUnit.indexedMaterialDescriptor,
					})
				: null;
		drawUnit.texturePageBindings = collectDirectDrawTexturePageBindings({
			texture: drawUnit.texture,
			directIndexedMaterialResources: drawUnit.directIndexedMaterialResources,
			indexedMaterialDescriptor: drawUnit.indexedMaterialDescriptor,
			detailOverlay: drawUnit.detailOverlay,
			directTextureSamplingPolicy: drawUnit.directTextureSamplingPolicy,
			texturePageReadiness: drawUnit.texturePageReadiness,
		});
	}
}

function destroyWebgl2DrawUnit(drawUnit: Webgl2WorldDrawUnit): void {
	drawUnit.vertexArray.dispose();
	drawUnit.vertexBuffer.dispose();
	drawUnit.uvBuffer?.dispose();
	drawUnit.indexBuffer.dispose();
}

function resolveWebgl2MaterialFallbackReason(
	drawUnit: Webgl2DrawUnitAssembly,
): string | null {
	if (drawUnit.material.kind === "direct-texture") {
		if (!drawUnit.geometry.uvs) {
			return `webgl2 direct texture ${drawUnit.material.key} has no UV buffer`;
		}
		return drawUnit.material.fallbackReason;
	}
	if (drawUnit.material.kind === "indexed-paletted") {
		if (!drawUnit.geometry.uvs) {
			return `webgl2 indexed material ${drawUnit.material.key} has no UV buffer`;
		}
		return drawUnit.material.fallbackReason;
	}
	return drawUnit.material.fallbackReason;
}

function resolveWebgl2DrawUnitDirectTextureSamplingPolicy(
	drawUnit: Webgl2DrawUnitAssembly,
): TextureSamplingPolicy | null {
	return drawUnit.material.kind === "direct-texture"
		? drawUnit.material.textureUpload.upload.samplingPolicy
		: null;
}

function resolveWebgl2DrawUnitTextureUploadSample(
	drawUnit: Webgl2DrawUnitAssembly,
): string | null {
	if (drawUnit.material.kind !== "direct-texture") {
		return null;
	}
	const upload = drawUnit.material.textureUpload.upload;
	if (upload.kind !== "direct") {
		return null;
	}
	const stats = sampleDirectTextureBytes(upload.data, upload.format);
	return [
		drawUnit.material.textureKey,
		`${upload.width}x${upload.height}`,
		upload.format,
		upload.dataType,
		`mips=${upload.samplingPolicy.generateMipmaps ? "on" : "off"}`,
		`first=${stats.firstPixel}`,
		`firstAlpha=${stats.firstAlphaPixel}`,
		`nonZeroRgb=${stats.nonZeroRgbSampleCount}/${stats.sampleCount}`,
		`nonZeroAlpha=${stats.nonZeroAlphaSampleCount}/${stats.sampleCount}`,
	].join(" ");
}

function resolveWebgl2IndexedMaterialDescriptor(
	drawUnit: Webgl2DrawUnitAssembly,
): Webgl2IndexedMaterialDescriptor | null {
	if (drawUnit.material.kind !== "indexed-paletted" || !drawUnit.geometry.uvs) {
		return null;
	}
	const indexedMaterial = drawUnit.material.indexedMaterial;
	const indexTextureKey = describeIndexedTextureKey(indexedMaterial);
	const paletteTextureKey = describeIndexedPaletteTextureKey(indexedMaterial);
	return {
		key: drawUnit.material.key,
		indexFormat: indexedMaterial.texture.format,
		indexTextureKey,
		paletteTextureKey,
		width: indexedMaterial.texture.width,
		height: indexedMaterial.texture.height,
		indexSourceBytes: indexedMaterial.texture.sourceBytes,
		paletteColorCount: indexedMaterial.palette.colorCount,
		paletteRgbaBytes: indexedMaterial.palette.colorsRgba,
		wrapS: indexedMaterial.samplingPolicy.wrapS,
		wrapT: indexedMaterial.samplingPolicy.wrapT,
		clipThreshold: isBase1ClipMapSurface(indexedMaterial.recipe.surfaceType)
			? 8
			: -1,
	};
}

function resolveWebgl2DirectIndexedMaterialResources({
	gl,
	store,
	drawUnit,
	descriptor,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: Webgl2DrawUnitAssembly;
	descriptor: Webgl2IndexedMaterialDescriptor | null;
}): Webgl2DirectIndexedMaterialResources | null {
	if (!descriptor || drawUnit.material.kind !== "indexed-paletted") {
		return null;
	}
	const indexedMaterial = drawUnit.material.indexedMaterial;
	const indexTexture =
		store.texturesByKey.get(descriptor.indexTextureKey) ??
		createAndStoreWebgl2Texture2D({
			gl,
			store,
			key: descriptor.indexTextureKey,
			upload: toWebgl2IndexedTextureUpload(gl, indexedMaterial.texture),
			sampler: {
				wrapS: descriptor.wrapS === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
				wrapT: descriptor.wrapT === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
				minFilter: gl.NEAREST,
				magFilter: gl.NEAREST,
			},
		});
	const paletteTexture =
		store.texturesByKey.get(descriptor.paletteTextureKey) ??
		createAndStoreWebgl2Texture2D({
			gl,
			store,
			key: descriptor.paletteTextureKey,
			upload: {
				width: descriptor.paletteColorCount,
				height: 1,
				internalFormat: gl.RGBA8,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
				data: descriptor.paletteRgbaBytes,
				generateMipmaps: false,
			},
			sampler: {
				wrapS: gl.CLAMP_TO_EDGE,
				wrapT: gl.CLAMP_TO_EDGE,
				minFilter: gl.NEAREST,
				magFilter: gl.NEAREST,
			},
		});
	return {
		descriptor,
		indexTexture,
		paletteTexture,
	};
}

function createAndStoreWebgl2Texture2D({
	gl,
	store,
	key,
	upload,
	sampler,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	key: string;
	upload: Parameters<typeof createWebgl2Texture2D>[1]["upload"];
	sampler: Parameters<typeof createWebgl2Texture2D>[1]["sampler"];
}): Webgl2Texture2DResource {
	const texture = profileBrowserJsScope("webgl2.texture.upload.shared", () =>
		createWebgl2Texture2D(gl, {
			label: key,
			upload,
			sampler,
		}),
	);
	store.texturesByKey.set(key, texture);
	return texture;
}

function toWebgl2IndexedTextureUpload(
	gl: WebGL2RenderingContext,
	texture: ResolvedIndexedMaterialData["texture"],
) {
	if (texture.format === "p8") {
		return {
			width: texture.width,
			height: texture.height,
			internalFormat: gl.R8,
			format: gl.RED,
			type: gl.UNSIGNED_BYTE,
			data: texture.sourceBytes,
			generateMipmaps: false,
		};
	}
	return {
		width: texture.width,
		height: texture.height,
		internalFormat: gl.RG8,
		format: gl.RG,
		type: gl.UNSIGNED_BYTE,
		data: texture.sourceBytes,
		generateMipmaps: false,
	};
}

function describeIndexedTextureKey(
	indexedMaterial: ResolvedIndexedMaterialData,
): string {
	return [
		"indexed-texture",
		indexedMaterial.renderSurfaceAssetId,
		indexedMaterial.texture.format,
		indexedMaterial.samplingPolicy.wrapS,
		indexedMaterial.samplingPolicy.wrapT,
	].join("|");
}

function describeIndexedPaletteTextureKey(
	indexedMaterial: ResolvedIndexedMaterialData,
): string {
	const paletteKey =
		"key" in indexedMaterial.palette
			? indexedMaterial.palette.key
			: indexedMaterial.palette.paletteAssetId;
	return ["indexed-palette", paletteKey].join("|");
}

function resolveWebgl2DrawUnitTexturePageReadiness(
	drawUnit: Webgl2DrawUnitAssembly,
): StagedWorldMaterialTexturePageReadiness | null {
	return drawUnit.material.kind === "direct-texture"
		? drawUnit.material.texturePageReadiness
		: null;
}

function resolveWebgl2DrawUnitTexture({
	gl,
	store,
	drawUnit,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: Webgl2DrawUnitAssembly;
}): Webgl2Texture2DResource | null {
	if (drawUnit.material.kind !== "direct-texture" || !drawUnit.geometry.uvs) {
		return null;
	}
	const material = drawUnit.material;
	const cached = store.texturesByKey.get(material.textureKey);
	if (cached) {
		return cached;
	}
	const uploadErrorBefore = gl.getError();
	const texture = profileBrowserJsScope("webgl2.texture.upload.direct", () =>
		createWebgl2Texture2D(gl, {
			label: material.textureKey,
			upload: toWebgl2TextureUpload(gl, material.textureUpload),
			sampler: toWebgl2SamplerParameters(
				gl,
				material.textureUpload.upload.samplingPolicy,
			),
		}),
	);
	const uploadErrorAfter = gl.getError();
	if (uploadErrorBefore !== gl.NO_ERROR || uploadErrorAfter !== gl.NO_ERROR) {
		store.materialFallbackReasonSamples = [
			...store.materialFallbackReasonSamples,
			`webgl2 texture upload ${material.textureKey} gl errors before=${uploadErrorBefore} after=${uploadErrorAfter}`,
		].slice(0, 8);
	}
	store.texturesByKey.set(material.textureKey, texture);
	return texture;
}

function resolveWebgl2DetailOverlayResources({
	assetState,
	gl,
	store,
	drawUnit,
	materialTextureCapabilities,
	textureFilteringMode,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: Webgl2DrawUnitAssembly;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2DetailOverlayResources | null {
	const overlay =
		drawUnit.material.kind === "direct-texture" ||
		drawUnit.material.kind === "indexed-paletted"
			? drawUnit.material.detailOverlay
			: null;
	if (!overlay || !drawUnit.geometry.uvs || overlay.blendMode !== "dst-color") {
		return null;
	}
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
	const key = describeWebgl2DirectRenderSurfaceTextureKey(
		overlay.renderSurface,
		samplingPolicy,
	);
	const upload = prepareRenderSurfaceTextureUploadData(
		overlay.renderSurface,
		samplingPolicy,
		materialTextureCapabilities,
		resolvePreparedTextureForRenderSurface(
			assetState,
			overlay.renderSurface,
			"detail",
		),
	);
	if (upload.status !== "ready" || upload.upload.kind !== "direct") {
		if (upload.status === "ready") {
			warnUnsupportedDetailAtlasTexture({
				key,
				overlay,
				upload,
			});
		}
		store.materialFallbackReasonSamples = [
			...store.materialFallbackReasonSamples,
			`detail-overlay ${overlay.signature} texture ${formatHex32(overlay.renderSurface.renderSurfaceId)} is ${upload.status === "ready" ? "compressed-direct-unsupported" : upload.reason}`,
		].slice(0, 8);
		return null;
	}
	const atlasEntry = resolveDetailAtlasEntry({ key, overlay, upload });
	if (!atlasEntry) {
		warnUnsupportedDetailAtlasTexture({
			key,
			overlay,
			upload,
		});
	}
	const cached = store.texturesByKey.get(key);
	if (cached) {
		return {
			key,
			texture: cached,
			tiling: overlay.role.tiling,
			blendMode: overlay.blendMode,
			atlasEntry,
		};
	}
	const texture = profileBrowserJsScope("webgl2.texture.upload.detail", () =>
		createWebgl2Texture2D(gl, {
			label: key,
			upload: toWebgl2TextureUpload(gl, upload),
			sampler: toWebgl2SamplerParameters(gl, upload.upload.samplingPolicy),
		}),
	);
	store.texturesByKey.set(key, texture);
	return {
		key,
		texture,
		tiling: overlay.role.tiling,
		blendMode: overlay.blendMode,
		atlasEntry,
	};
}

function warnUnsupportedDetailAtlasTexture({
	key,
	overlay,
	upload,
}: {
	key: string;
	overlay: ResolvedRegionDetailOverlayPlan;
	upload: RenderSurfaceTextureUploadPreparation & { status: "ready" };
}): void {
	const texture = upload.upload;
	if (
		texture.kind === "direct" &&
		texture.format === "rgba" &&
		texture.dataType === "uint8" &&
		texture.data instanceof Uint8Array
	) {
		return;
	}
	if (warnedUnsupportedDetailAtlasTextureKeys.has(key)) {
		return;
	}
	warnedUnsupportedDetailAtlasTextureKeys.add(key);
	const uploadShape =
		texture.kind === "direct"
			? `direct ${texture.format}/${texture.dataType}/${texture.internalFormat ?? "no-internal-format"}`
			: `compressed ${texture.format}`;
	console.warn(
		[
			"[Holtburger 3D] Detail overlay texture is not RGBA8 atlas-compatible; compacted geometry will stage it separately.",
			`surface=${formatHex32(overlay.renderSurface.renderSurfaceId)}`,
			`sourceFormat=${overlay.renderSurface.format}(${formatHex32(overlay.renderSurface.formatRaw)})`,
			`upload=${uploadShape}`,
			`size=${texture.width}x${texture.height}`,
			`overlay=${overlay.signature}`,
		].join(" "),
	);
}

function resolveDetailAtlasEntry({
	key,
	overlay,
	upload,
}: {
	key: string;
	overlay: ResolvedRegionDetailOverlayPlan;
	upload: (RenderSurfaceTextureUploadPreparation & { status: "ready" }) | null;
}): RgbaTexturePageDetailAtlasEntry | null {
	if (!upload || upload.upload.kind !== "direct") {
		return null;
	}
	if (
		upload.upload.format !== "rgba" ||
		upload.upload.dataType !== "uint8" ||
		!(upload.upload.data instanceof Uint8Array)
	) {
		return null;
	}
	return {
		key: `detail-atlas-entry|${key}`,
		renderSurfaceId: overlay.renderSurface.renderSurfaceId,
		sourceFormatRaw: overlay.renderSurface.formatRaw,
		width: upload.upload.width,
		height: upload.upload.height,
		bytes: upload.upload.data,
		format: "rgba8",
		tiling: overlay.role.tiling,
		blendMode: overlay.blendMode,
	};
}

function resolvePreparedTextureForRenderSurface(
	assetState: AssetChannelState,
	renderSurface: TerrainBlendTextureRef["renderSurface"],
	usage: "raw" | "detail" = "raw",
): PreparedTexturePayload | null {
	for (const assetId of resolveNormalizedPreparedTextureAssetIds({
		renderSurface,
		usage,
	})) {
		const asset = assetState.preparedByAssetId[assetId];
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

function collectDirectIndexedMaterialTextureKeys(
	drawUnit: Webgl2WorldDrawUnit,
): readonly string[] {
	if (!drawUnit.directIndexedMaterialResources) {
		return [];
	}
	return [
		drawUnit.directIndexedMaterialResources.descriptor.indexTextureKey,
		drawUnit.directIndexedMaterialResources.descriptor.paletteTextureKey,
	];
}

function toWebgl2TextureUpload(
	gl: WebGL2RenderingContext,
	textureUpload: RenderSurfaceTextureUploadPreparation & { status: "ready" },
) {
	const upload = textureUpload.upload;
	if (upload.kind !== "direct") {
		throw new Error(
			`WebGL2 direct material upload does not support compressed texture ${upload.renderSurfaceId}.`,
		);
	}
	const format = toWebgl2TextureFormat(gl, upload.format);
	return {
		width: upload.width,
		height: upload.height,
		internalFormat: toWebgl2TextureInternalFormat(
			gl,
			upload.format,
			upload.dataType,
			upload.internalFormat,
		),
		format,
		type: toWebgl2TextureType(gl, upload.dataType),
		data: upload.data,
		generateMipmaps: upload.samplingPolicy.generateMipmaps,
	};
}

function describeWebgl2DirectRenderSurfaceTextureKey(
	renderSurface: {
		renderSurfaceId: number;
		formatRaw: number;
		width: number;
		height: number;
	},
	samplingPolicy: TextureSamplingPolicy,
): string {
	return [
		"texture",
		formatHex32(renderSurface.renderSurfaceId),
		renderSurface.formatRaw,
		renderSurface.width,
		renderSurface.height,
		samplingPolicy.colorSpace,
		samplingPolicy.wrapS,
		samplingPolicy.wrapT,
		samplingPolicy.minFilter,
		samplingPolicy.magFilter,
		samplingPolicy.mipFilter,
	].join("/");
}

function toWebgl2TextureFormat(
	gl: WebGL2RenderingContext,
	format: DirectRenderSurfaceUploadFormat,
): GLenum {
	switch (format) {
		case "red":
			return gl.RED;
		case "rgb":
			return gl.RGB;
		case "rgba":
			return gl.RGBA;
	}
}

function toWebgl2TextureInternalFormat(
	gl: WebGL2RenderingContext,
	format: DirectRenderSurfaceUploadFormat,
	dataType: DirectRenderSurfaceUploadDataType,
	internalFormat: DirectRenderSurfaceUploadInternalFormat | null,
): GLenum {
	if (internalFormat === "r8") {
		return gl.R8;
	}
	if (internalFormat === "rgb8") {
		return gl.RGB8;
	}
	if (dataType === "uint16-rgba4444") {
		return gl.RGBA4;
	}
	if (format === "rgb") {
		return gl.RGB8;
	}
	if (format === "red") {
		return gl.R8;
	}
	return gl.RGBA8;
}

function toWebgl2TextureType(
	gl: WebGL2RenderingContext,
	dataType: DirectRenderSurfaceUploadDataType,
): GLenum {
	switch (dataType) {
		case "uint8":
			return gl.UNSIGNED_BYTE;
		case "uint16-rgba4444":
			return gl.UNSIGNED_SHORT_4_4_4_4;
	}
}

function toWebgl2SamplerParameters(
	gl: WebGL2RenderingContext,
	policy: TextureSamplingPolicy,
) {
	return {
		wrapS: policy.wrapS === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
		wrapT: policy.wrapT === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
		minFilter: toWebgl2MinFilter(gl, policy),
		magFilter: policy.magFilter === "nearest" ? gl.NEAREST : gl.LINEAR,
		maxAnisotropy: policy.anisotropy,
	};
}

function toWebgl2MinFilter(
	gl: WebGL2RenderingContext,
	policy: TextureSamplingPolicy,
): GLenum {
	if (policy.mipFilter === "none") {
		return policy.minFilter === "nearest" ? gl.NEAREST : gl.LINEAR;
	}
	if (policy.minFilter === "nearest") {
		return policy.mipFilter === "nearest"
			? gl.NEAREST_MIPMAP_NEAREST
			: gl.NEAREST_MIPMAP_LINEAR;
	}
	return policy.mipFilter === "nearest"
		? gl.LINEAR_MIPMAP_NEAREST
		: gl.LINEAR_MIPMAP_LINEAR;
}

function countPreparedTextureUploads(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): number {
	return new Set(
		drawUnits.flatMap((drawUnit) =>
			drawUnit.textureKey
				? [
						drawUnit.textureKey,
						...collectDirectIndexedMaterialTextureKeys(drawUnit),
						...(drawUnit.detailOverlay ? [drawUnit.detailOverlay.key] : []),
					]
				: [
						...collectDirectIndexedMaterialTextureKeys(drawUnit),
						...(drawUnit.detailOverlay ? [drawUnit.detailOverlay.key] : []),
					],
		),
	).size;
}

function countStringOccurrences(
	values: readonly string[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) {
		counts[value] = (counts[value] ?? 0) + 1;
	}
	return counts;
}

function collectCompactionCoverageMetrics(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): {
	drawUnitCounts: Record<string, number>;
	materialBlockerCounts: Record<string, number>;
	geometryBlockerCounts: Record<string, number>;
	materialFamilyCounts: Record<string, number>;
	materialAlphaPolicyCounts: Record<string, number>;
	materialFamilyAlphaPolicyCounts: Record<string, number>;
	retainedDirectMaterialFamilyCounts: Record<string, number>;
	retainedDirectMaterialFamilyAlphaPolicyCounts: Record<string, number>;
} {
	const drawUnitCounts: Record<string, number> = {};
	const materialBlockers: string[] = [];
	const geometryBlockers: string[] = [];
	const materialFamilies: string[] = [];
	const materialAlphaPolicies: string[] = [];
	const materialFamilyAlphaPolicies: string[] = [];
	const retainedDirectMaterialFamilies: string[] = [];
	const retainedDirectMaterialFamilyAlphaPolicies: string[] = [];
	for (const drawUnit of drawUnits) {
		const materialFamily = drawUnit.compactionEligibility.material.family;
		const alphaPolicy = drawUnit.compactionEligibility.material.alphaPolicy;
		const materialFamilyAlphaPolicy = `${materialFamily}|alpha=${alphaPolicy}`;
		incrementCount(drawUnitCounts, "total");
		if (drawUnit.kind === "static" || drawUnit.kind === "structured-interior") {
			incrementCount(drawUnitCounts, "static-or-structured-total");
		}
		if (drawUnit.compactionEligibility.decision === "compacted") {
			incrementCount(drawUnitCounts, "compacted-compatible");
		} else {
			incrementCount(drawUnitCounts, "retained-direct");
			if (
				drawUnit.kind === "static" ||
				drawUnit.kind === "structured-interior"
			) {
				incrementCount(drawUnitCounts, "static-or-structured-retained-direct");
			}
			retainedDirectMaterialFamilies.push(materialFamily);
			retainedDirectMaterialFamilyAlphaPolicies.push(materialFamilyAlphaPolicy);
		}
		materialFamilies.push(materialFamily);
		materialAlphaPolicies.push(alphaPolicy);
		materialFamilyAlphaPolicies.push(materialFamilyAlphaPolicy);
		materialBlockers.push(...drawUnit.compactionEligibility.material.blockers);
		geometryBlockers.push(...drawUnit.compactionEligibility.geometry.blockers);
	}
	return {
		drawUnitCounts,
		materialBlockerCounts: countStringOccurrences(materialBlockers),
		geometryBlockerCounts: countStringOccurrences(geometryBlockers),
		materialFamilyCounts: countStringOccurrences(materialFamilies),
		materialAlphaPolicyCounts: countStringOccurrences(materialAlphaPolicies),
		materialFamilyAlphaPolicyCounts: countStringOccurrences(
			materialFamilyAlphaPolicies,
		),
		retainedDirectMaterialFamilyCounts: countStringOccurrences(
			retainedDirectMaterialFamilies,
		),
		retainedDirectMaterialFamilyAlphaPolicyCounts: countStringOccurrences(
			retainedDirectMaterialFamilyAlphaPolicies,
		),
	};
}

function incrementCount(counts: Record<string, number>, key: string): void {
	counts[key] = (counts[key] ?? 0) + 1;
}

function describeCompactionBypassBlockerSample(
	bypass: {
		drawUnitId: string;
		reason: string;
		blockerKind: string;
		blocker: string;
	},
	drawUnitById: ReadonlyMap<string, Webgl2WorldDrawUnit>,
): string {
	const base = `${bypass.reason}:${bypass.blockerKind}:${bypass.blocker}`;
	const drawUnit = drawUnitById.get(bypass.drawUnitId);
	if (!drawUnit) {
		return `${base}|drawUnit=missing`;
	}
	const material = drawUnit.compactionEligibility.material;
	const detailOverlay = drawUnit.detailOverlay !== null ? "yes" : "no";
	const detailAtlas = drawUnit.detailOverlay?.atlasEntry ? "yes" : "no";
	const usageSources = summarizeTexturePageUsageSources(
		drawUnit.texturePageBindings,
	);
	return [
		base,
		`family=${material.family}`,
		`alpha=${material.alphaPolicy}`,
		`detailOverlay=${detailOverlay}`,
		`detailAtlas=${detailAtlas}`,
		`usageSources=${usageSources}`,
	].join("|");
}

function summarizeTexturePageUsageSources(
	bindings: readonly TexturePageDescriptor[],
): string {
	const pairs = new Set(
		bindings.map((binding) => `${binding.usageBucket}:${binding.source}`),
	);
	return [...pairs].sort().join("+") || "none";
}

function summarizeDiagnosticReasons(
	reasons: readonly string[],
	limit: number,
): string[] {
	const counts = countStringOccurrences(reasons.map(normalizeDiagnosticReason));
	return Object.entries(counts)
		.sort(([, left], [, right]) => right - left)
		.slice(0, limit)
		.map(([reason, count]) => (count === 1 ? reason : `${reason} x${count}`));
}

function normalizeDiagnosticReason(reason: string): string {
	if (reason.includes("is indexed/paletted")) {
		return "indexed/paletted material unavailable";
	}
	if (reason.startsWith("missing atlas-ready prepared texture ")) {
		return "missing atlas-ready prepared texture";
	}
	if (reason.includes("has no UV buffer")) {
		return "material draw unit has no UV buffer";
	}
	return reason;
}

function sampleDirectTextureBytes(
	data: Uint8Array | Uint16Array,
	format: DirectRenderSurfaceUploadFormat,
): {
	firstPixel: string;
	firstAlphaPixel: string;
	nonZeroRgbSampleCount: number;
	nonZeroAlphaSampleCount: number;
	sampleCount: number;
} {
	const channelCount = format === "red" ? 1 : format === "rgb" ? 3 : 4;
	const pixelCount = Math.floor(data.length / channelCount);
	const sampleCount = Math.min(pixelCount, 256);
	let firstPixel = "none";
	let firstAlphaPixel = "none";
	let nonZeroRgbSampleCount = 0;
	let nonZeroAlphaSampleCount = 0;
	for (let pixelIndex = 0; pixelIndex < sampleCount; pixelIndex += 1) {
		const offset = pixelIndex * channelCount;
		const red = data[offset] ?? 0;
		const green = channelCount > 1 ? (data[offset + 1] ?? 0) : red;
		const blue = channelCount > 2 ? (data[offset + 2] ?? 0) : red;
		const alpha = channelCount > 3 ? (data[offset + 3] ?? 255) : 255;
		const pixel = `${red},${green},${blue},${alpha}`;
		if (pixelIndex === 0) {
			firstPixel = pixel;
		}
		if (firstAlphaPixel === "none" && alpha > 0) {
			firstAlphaPixel = pixel;
		}
		if (red > 0 || green > 0 || blue > 0) {
			nonZeroRgbSampleCount += 1;
		}
		if (alpha > 0) {
			nonZeroAlphaSampleCount += 1;
		}
	}
	return {
		firstPixel,
		firstAlphaPixel,
		nonZeroRgbSampleCount,
		nonZeroAlphaSampleCount,
		sampleCount,
	};
}

function createGeometrySignature(
	drawUnit: Webgl2DrawUnitAssembly,
): string {
	return [
		drawUnit.kind,
		drawUnit.material.kind,
		drawUnit.material.key,
		drawUnit.geometry.signature,
		`v${drawUnit.geometry.vertexCount}`,
		`t${drawUnit.geometry.triangleCount}`,
		`p${drawUnit.geometry.positions.length}`,
		`u${drawUnit.geometry.uvs ? drawUnit.geometry.uvs.length : "none"}`,
		`i${drawUnit.geometry.indices.length}`,
	].join(":");
}

function countUniqueStaticObjectKeys(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): number {
	return new Set(drawUnits.flatMap((drawUnit) => drawUnit.staticObjectKeys))
		.size;
}

function countUniqueBvhItemKeys(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): number {
	return new Set(drawUnits.flatMap((drawUnit) => drawUnit.bvhItemKeys)).size;
}

function collectTextureSamplingPolicySamples(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): readonly string[] {
	return drawUnits.flatMap((drawUnit) => {
		if (drawUnit.directTextureSamplingPolicy) {
			return [
				describeTextureSamplingPolicy(drawUnit.directTextureSamplingPolicy),
			];
		}
		if (drawUnit.directIndexedMaterialResources) {
			return [
				describeIndexedTexturePageSamplingPolicy(
					drawUnit.directIndexedMaterialResources.descriptor.wrapS,
					drawUnit.directIndexedMaterialResources.descriptor.wrapT,
				),
			];
		}
		return [];
	});
}

function describeIndexedTexturePageSamplingPolicy(
	wrapS: TextureSamplingPolicy["wrapS"],
	wrapT: TextureSamplingPolicy["wrapT"],
): string {
	return describeTextureSamplingPolicy({
		wrapS,
		wrapT,
		magFilter: "nearest",
		minFilter: "nearest",
		mipFilter: "none",
		colorSpace: "none",
		anisotropy: 1,
		generateMipmaps: false,
		flipY: false,
	});
}

function resolveWebgl2DrawUnitTexturePageBindings(
	store: Webgl2WorldResourceStore,
): void {
	for (const drawUnit of store.drawUnits) {
		const baseResolution = resolveDirectDrawBaseTexturePageBinding({
			drawUnit,
			generation: store.textureAtlasGeneration,
			atlasPlan: store.texturePageAtlasPlan,
			fallbackSamples: [],
		});
		drawUnit.texturePageBindings = [
			...(baseResolution.binding ? [baseResolution.binding] : []),
			...drawUnit.texturePageBindings.filter(
				(binding) => binding.usageBucket !== "base-color",
			),
		];
		drawUnit.texturePageBindingFallbackSamples = baseResolution.fallbackSamples;
	}
}

function syncWebgl2TextureAtlasGeneration({
	gl,
	store,
	plan,
	textureFilteringMode,
	maxAnisotropy,
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: TexturePageAtlasPlan;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	if (
		store.textureAtlasGenerationGraph &&
		store.textureAtlasGenerationGraph !== rendererResourceGraph
	) {
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
	}
	if (!requiresTextureAtlasGeneration(plan)) {
		store.textureAtlasWorkerScheduler?.reset();
		store.textureAtlasWorkerMetrics =
			store.textureAtlasWorkerScheduler?.getMetrics() ??
			store.textureAtlasWorkerMetrics;
		store.textureAtlasGeneration?.dispose();
		store.textureAtlasGeneration = null;
		store.pendingTextureAtlasGenerationKey = null;
		store.textureAtlasGenerationTextureCount = 0;
		store.detailTextureAtlasGenerationTextureCount = 0;
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
		return;
	}
	const generationKey = describeWebgl2TextureAtlasGenerationKey({
		planKey: plan.key,
		textureFilteringMode,
		maxAnisotropy,
	});
	const textureAtlasWorkerScheduler = store.textureAtlasWorkerScheduler;
	if (!textureAtlasWorkerScheduler) {
		throw new Error(
			"Texture atlas generation requires a texture atlas worker scheduler.",
		);
	}
	for (const result of textureAtlasWorkerScheduler.consumeReadyResults()) {
		if (result.key !== generationKey) {
			continue;
		}
		if (!result.generation) {
			throw new Error(
				`Texture atlas worker result ${result.key} produced no generation for a desired atlas plan.`,
			);
		}
		const cpuGeneration = result.generation;
		if (cpuGeneration.key !== generationKey) {
			throw new Error(
				`Texture atlas worker result ${result.key} produced generation ${cpuGeneration.key}, expected ${generationKey}.`,
			);
		}
		const nextGeneration = profileBrowserJsScope(
			"webgl2.resource.commitTextureAtlasGeneration",
			() =>
				createWebgl2TextureAtlasGenerationResourceFromCpu({
					gl,
					cpuGeneration,
					textureFilteringMode,
					maxAnisotropy,
				}),
		);
		commitWebgl2TextureAtlasGeneration({
			store,
			generation: nextGeneration,
		});
		textureAtlasWorkerScheduler.markCommitted(result.key);
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
	}
	if (store.textureAtlasGeneration?.key !== generationKey) {
		markWebgl2TextureAtlasGenerationReplacementPending({
			store,
			generationKey,
		});
		textureAtlasWorkerScheduler.scheduleDesired({
			plan,
			textureFilteringMode,
			maxAnisotropy,
		});
	} else if (store.textureAtlasGeneration) {
		store.textureAtlasGeneration = refreshWebgl2TextureAtlasGenerationCoverage({
			generation: store.textureAtlasGeneration,
			plan,
		});
	}
	store.textureAtlasWorkerMetrics = textureAtlasWorkerScheduler.getMetrics();
	store.textureAtlasGenerationTextureCount =
		store.textureAtlasGeneration?.textures.length ?? 0;
	store.detailTextureAtlasGenerationTextureCount =
		store.textureAtlasGeneration?.detailTextures.length ?? 0;
	if (!rendererResourceGraph || !store.textureAtlasGeneration) {
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
		return;
	}
	upsertWebgl2TextureAtlasGenerationGraph({
		graph: rendererResourceGraph,
		generation: store.textureAtlasGeneration,
	});
	if (
		store.textureAtlasGenerationGraphLease?.nodeKey ===
		atlasGenerationGraphNodeKey(store.textureAtlasGeneration.key)
	) {
		return;
	}
	releaseWebgl2TextureAtlasGenerationGraphLease(store);
	store.textureAtlasGenerationGraphLease = rendererResourceGraph.leaseNode(
		atlasGenerationGraphNodeKey(store.textureAtlasGeneration.key),
		"webgl2 texture atlas generation",
	);
	store.textureAtlasGenerationGraph = rendererResourceGraph;
}

function requiresTextureAtlasGeneration(plan: TexturePageAtlasPlan): boolean {
	return (
		plan.rgbaAtlasReadyDrawUnitIds.length > 0 ||
		plan.detailAtlasTextures.length > 0
	);
}

function refreshWebgl2TextureAtlasGenerationCoverage({
	generation,
	plan,
}: {
	generation: Webgl2TextureAtlasGenerationResource;
	plan: TexturePageAtlasPlan;
}): Webgl2TextureAtlasGenerationResource {
	if (
		stringArraysEqual(
			generation.rgbaAtlasReadyDrawUnitIds,
			plan.rgbaAtlasReadyDrawUnitIds,
		) &&
		stringArraysEqual(
			generation.preparedTextureAssetIds,
			plan.preparedTextureAssetIds,
		)
	) {
		return generation;
	}
	return {
		...generation,
		rgbaAtlasReadyDrawUnitIds: plan.rgbaAtlasReadyDrawUnitIds,
		preparedTextureAssetIds: plan.preparedTextureAssetIds,
	};
}

function stringArraysEqual(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function upsertWebgl2TextureAtlasGenerationGraph({
	graph,
	generation,
}: {
	graph: RendererResourceGraph;
	generation: Webgl2TextureAtlasGenerationResource;
}): void {
	const atlasNodeKey = atlasGenerationGraphNodeKey(generation.key);
	const preparedNodeKeys = generation.preparedTextureAssetIds.map(
		preparedAssetGraphNodeKey,
	);
	graph.applyBatchUpdate({
		nodes: [
			{
				key: atlasNodeKey,
				kind: "atlas-generation",
			},
			...generation.preparedTextureAssetIds.map((assetId, index) => ({
				key: preparedNodeKeys[index],
				kind: "prepared-asset" as const,
			})),
		],
		dependencyReplacements: [
			{
				nodeKey: atlasNodeKey,
				dependencyKeys: preparedNodeKeys,
			},
		],
	});
}

function releaseWebgl2TextureAtlasGenerationGraphLease(
	store: Webgl2WorldResourceStore,
): void {
	if (!store.textureAtlasGenerationGraphLease) {
		return;
	}
	if (!store.textureAtlasGenerationGraph) {
		throw new Error("Texture atlas generation graph lease has no bound graph.");
	}
	store.textureAtlasGenerationGraph.releaseLease(
		store.textureAtlasGenerationGraphLease,
	);
	store.textureAtlasGenerationGraphLease = null;
	store.textureAtlasGenerationGraph = null;
}

function syncWebgl2IndexedResourceAtlasGeneration({
	gl,
	store,
	plan,
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: IndexedResourceAtlasPlan;
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	if (
		store.indexedResourceAtlasGenerationGraph &&
		store.indexedResourceAtlasGenerationGraph !== rendererResourceGraph
	) {
		releaseWebgl2IndexedResourceAtlasGenerationGraphLease(store);
	}
	if (!requiresIndexedResourceAtlasGeneration(plan)) {
		store.indexedResourceAtlasWorkerScheduler?.reset();
		store.indexedResourceAtlasWorkerMetrics =
			store.indexedResourceAtlasWorkerScheduler?.getMetrics() ??
			store.indexedResourceAtlasWorkerMetrics;
		store.indexedResourceAtlasGeneration?.dispose();
		store.indexedResourceAtlasGeneration = null;
		store.pendingIndexedResourceAtlasGenerationKey = null;
		store.indexedResourceAtlasIndexTextureCount = 0;
		store.indexedResourceAtlasPaletteTextureCount = 0;
		releaseWebgl2IndexedResourceAtlasGenerationGraphLease(store);
		return;
	}
	const generationKey = describeWebgl2IndexedResourceAtlasGenerationKey(
		plan.key,
	);
	const indexedAtlasWorkerScheduler = store.indexedResourceAtlasWorkerScheduler;
	if (!indexedAtlasWorkerScheduler) {
		throw new Error(
			"Indexed resource atlas generation requires an indexed atlas worker scheduler.",
		);
	}
	for (const result of indexedAtlasWorkerScheduler.consumeReadyResults()) {
		if (result.key !== plan.key) {
			continue;
		}
		if (!result.generation) {
			throw new Error(
				`Indexed resource atlas worker result ${result.key} produced no generation for a desired atlas plan.`,
			);
		}
		const cpuGeneration = result.generation;
		if (cpuGeneration.key !== generationKey) {
			throw new Error(
				`Indexed resource atlas worker result ${result.key} produced generation ${cpuGeneration.key}, expected ${generationKey}.`,
			);
		}
		const nextGeneration = profileBrowserJsScope(
			"webgl2.resource.commitIndexedResourceAtlasGeneration",
			() =>
				createWebgl2IndexedResourceAtlasGenerationResourceFromCpu({
					gl,
					cpuGeneration,
				}),
		);
		commitWebgl2IndexedResourceAtlasGeneration({
			store,
			generation: nextGeneration,
		});
		indexedAtlasWorkerScheduler.markCommitted(result.key);
		releaseWebgl2IndexedResourceAtlasGenerationGraphLease(store);
	}
	if (store.indexedResourceAtlasGeneration?.key !== generationKey) {
		markWebgl2IndexedResourceAtlasGenerationReplacementPending({
			store,
			generationKey,
		});
		indexedAtlasWorkerScheduler.scheduleDesired(plan);
	}
	store.indexedResourceAtlasWorkerMetrics =
		indexedAtlasWorkerScheduler.getMetrics();
	store.indexedResourceAtlasIndexTextureCount =
		store.indexedResourceAtlasGeneration?.indexTextures.length ?? 0;
	store.indexedResourceAtlasPaletteTextureCount =
		store.indexedResourceAtlasGeneration?.paletteTextures.length ?? 0;
	if (!rendererResourceGraph || !store.indexedResourceAtlasGeneration) {
		releaseWebgl2IndexedResourceAtlasGenerationGraphLease(store);
		return;
	}
	upsertWebgl2IndexedResourceAtlasGenerationGraph({
		graph: rendererResourceGraph,
		generation: store.indexedResourceAtlasGeneration,
	});
	if (
		store.indexedResourceAtlasGenerationGraphLease?.nodeKey ===
		atlasGenerationGraphNodeKey(store.indexedResourceAtlasGeneration.key)
	) {
		return;
	}
	releaseWebgl2IndexedResourceAtlasGenerationGraphLease(store);
	store.indexedResourceAtlasGenerationGraphLease =
		rendererResourceGraph.leaseNode(
			atlasGenerationGraphNodeKey(store.indexedResourceAtlasGeneration.key),
			"webgl2 indexed resource atlas generation",
		);
	store.indexedResourceAtlasGenerationGraph = rendererResourceGraph;
}

function requiresIndexedResourceAtlasGeneration(
	plan: IndexedResourceAtlasPlan,
): boolean {
	return (
		plan.p8IndexAtlasTextures.length > 0 ||
		plan.index16AtlasTextures.length > 0 ||
		plan.paletteAtlasTextures.length > 0
	);
}

function upsertWebgl2IndexedResourceAtlasGenerationGraph({
	graph,
	generation,
}: {
	graph: RendererResourceGraph;
	generation: Webgl2IndexedResourceAtlasGenerationResource;
}): void {
	const atlasNodeKey = atlasGenerationGraphNodeKey(generation.key);
	graph.applyBatchUpdate({
		nodes: [
			{
				key: atlasNodeKey,
				kind: "atlas-generation",
			},
		],
		dependencyReplacements: [
			{
				nodeKey: atlasNodeKey,
				dependencyKeys: [],
			},
		],
	});
}

function releaseWebgl2IndexedResourceAtlasGenerationGraphLease(
	store: Webgl2WorldResourceStore,
): void {
	if (!store.indexedResourceAtlasGenerationGraphLease) {
		return;
	}
	if (!store.indexedResourceAtlasGenerationGraph) {
		throw new Error(
			"Indexed resource atlas generation graph lease has no bound graph.",
		);
	}
	store.indexedResourceAtlasGenerationGraph.releaseLease(
		store.indexedResourceAtlasGenerationGraphLease,
	);
	store.indexedResourceAtlasGenerationGraphLease = null;
	store.indexedResourceAtlasGenerationGraph = null;
}

function syncWebgl2AssemblyGraph({
	graph,
	store,
	records,
	retainedDrawUnitIds,
}: {
	graph: RendererResourceGraph | undefined;
	store: Webgl2WorldResourceStore;
	records: readonly StagedWorldAssemblyGraphRecord[];
	retainedDrawUnitIds: ReadonlySet<string>;
}): void {
	if (!graph) {
		if (store.boundGraph) {
			for (const lease of store.graphLeasesByDrawUnitId.values()) {
				store.boundGraph.releaseLease(lease);
			}
			for (const lease of store.graphLeasesByTerrainTileId.values()) {
				store.boundGraph.releaseLease(lease);
			}
		}
		store.graphLeasesByDrawUnitId.clear();
		store.graphSignaturesByDrawUnitId.clear();
		store.graphLeasesByTerrainTileId.clear();
		store.graphSignaturesByTerrainTileId.clear();
		store.boundGraph = null;
		return;
	}
	if (store.boundGraph && store.boundGraph !== graph) {
		for (const lease of store.graphLeasesByDrawUnitId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		for (const lease of store.graphLeasesByTerrainTileId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		store.graphLeasesByDrawUnitId.clear();
		store.graphSignaturesByDrawUnitId.clear();
		store.graphLeasesByTerrainTileId.clear();
		store.graphSignaturesByTerrainTileId.clear();
	}
	store.boundGraph = graph;

	const changedRecords = records.filter((record) => {
		const signature = describeStagedWorldAssemblyGraphRecordSignature(record);
		return (
			store.graphSignaturesByDrawUnitId.get(record.drawUnitId) !== signature
		);
	});
	if (changedRecords.length > 0) {
		const nodes: RendererResourceGraphNode[] = [];
		const dependencyReplacements: RendererResourceGraphDependencyReplacement[] =
			[];
		for (const record of changedRecords) {
			const sceneNodeKey = sceneObjectGraphNodeKey(record.drawUnitId);
			const materialNodeKey = materialDecisionGraphNodeKey(
				`${record.drawUnitId}/${record.material.key}`,
			);
			const assetIds = uniqueSortedStrings(record.preparedAssetIds);
			const preparedNodeKeys = assetIds.map(preparedAssetGraphNodeKey);
			nodes.push(
				{
					key: sceneNodeKey,
					kind: "scene-object",
				},
				{
					key: materialNodeKey,
					kind: "material-decision",
				},
				...assetIds.map((assetId, index) => ({
					key: preparedNodeKeys[index],
					kind: "prepared-asset" as const,
				})),
			);
			dependencyReplacements.push(
				{
					nodeKey: sceneNodeKey,
					dependencyKeys: [materialNodeKey, ...preparedNodeKeys],
				},
				{
					nodeKey: materialNodeKey,
					dependencyKeys: preparedNodeKeys,
				},
			);
		}
		graph.applyBatchUpdate({ nodes, dependencyReplacements });
		for (const record of changedRecords) {
			const sceneNodeKey = sceneObjectGraphNodeKey(record.drawUnitId);
			if (!store.graphLeasesByDrawUnitId.has(record.drawUnitId)) {
				store.graphLeasesByDrawUnitId.set(
					record.drawUnitId,
					graph.leaseNode(sceneNodeKey, "webgl2 scene assembly"),
				);
			}
			store.graphSignaturesByDrawUnitId.set(
				record.drawUnitId,
				describeStagedWorldAssemblyGraphRecordSignature(record),
			);
		}
	}

	for (const [drawUnitId, lease] of store.graphLeasesByDrawUnitId) {
		if (retainedDrawUnitIds.has(drawUnitId)) {
			continue;
		}
		graph.releaseLease(lease);
		store.graphLeasesByDrawUnitId.delete(drawUnitId);
		store.graphSignaturesByDrawUnitId.delete(drawUnitId);
	}
}

function syncWebgl2TerrainTileGraph({
	graph,
	store,
	retainedTerrainTileIds,
}: {
	graph: RendererResourceGraph | undefined;
	store: Webgl2WorldResourceStore;
	retainedTerrainTileIds: ReadonlySet<string>;
}): void {
	if (!graph) {
		if (store.boundGraph) {
			for (const lease of store.graphLeasesByTerrainTileId.values()) {
				store.boundGraph.releaseLease(lease);
			}
		}
		store.graphLeasesByTerrainTileId.clear();
		store.graphSignaturesByTerrainTileId.clear();
		return;
	}
	if (store.boundGraph && store.boundGraph !== graph) {
		for (const lease of store.graphLeasesByTerrainTileId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		store.graphLeasesByTerrainTileId.clear();
		store.graphSignaturesByTerrainTileId.clear();
	}
	store.boundGraph = graph;

	const changedResources = store.terrainTiles.filter((resource) => {
		const signature = describeTerrainTileGraphSignature(resource);
		return store.graphSignaturesByTerrainTileId.get(resource.id) !== signature;
	});
	if (changedResources.length > 0) {
		const nodes: RendererResourceGraphNode[] = [];
		const dependencyReplacements: RendererResourceGraphDependencyReplacement[] =
			[];
		for (const resource of changedResources) {
			const sceneNodeKey = sceneObjectGraphNodeKey(resource.id);
			const assetIds = uniqueSortedStrings([
				resource.assetId,
				...(resource.readiness.status === "ready"
					? [resource.readiness.terrainMaterialAssetId]
					: []),
			]);
			const preparedNodeKeys = assetIds.map(preparedAssetGraphNodeKey);
			nodes.push(
				{
					key: sceneNodeKey,
					kind: "scene-object",
				},
				...assetIds.map((assetId, index) => ({
					key: preparedNodeKeys[index],
					kind: "prepared-asset" as const,
				})),
			);
			dependencyReplacements.push({
				nodeKey: sceneNodeKey,
				dependencyKeys: preparedNodeKeys,
			});
		}
		graph.applyBatchUpdate({ nodes, dependencyReplacements });
		for (const resource of changedResources) {
			const sceneNodeKey = sceneObjectGraphNodeKey(resource.id);
			if (!store.graphLeasesByTerrainTileId.has(resource.id)) {
				store.graphLeasesByTerrainTileId.set(
					resource.id,
					graph.leaseNode(sceneNodeKey, "webgl2 terrain tile resources"),
				);
			}
			store.graphSignaturesByTerrainTileId.set(
				resource.id,
				describeTerrainTileGraphSignature(resource),
			);
		}
	}

	for (const [terrainTileId, lease] of store.graphLeasesByTerrainTileId) {
		if (retainedTerrainTileIds.has(terrainTileId)) {
			continue;
		}
		graph.releaseLease(lease);
		store.graphLeasesByTerrainTileId.delete(terrainTileId);
		store.graphSignaturesByTerrainTileId.delete(terrainTileId);
	}
}
