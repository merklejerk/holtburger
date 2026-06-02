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
import { buildStagedTerrainGeometry } from "./staged-world-geometry";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type {
	IndexedMaterialDataCache,
	ResolvedIndexedMaterialData,
} from "./indexed-material-data";
import type { StagedWorldMaterialPlanCache } from "./staged-world-materials";
import type { ResolvedRegionDetailOverlayPlan } from "./region-detail-overlays";
import { createTranslationMat4, type RenderMat4, type RenderVec4 } from "./render-math";
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
import type {
	DirectRenderSurfaceUploadDataType,
	DirectRenderSurfaceUploadFormat,
	DirectRenderSurfaceUploadInternalFormat,
	MaterialTextureCapabilities,
	RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import { prepareRenderSurfaceTextureUploadData } from "./render-surface-texture-data";
import { isBase1ClipMapSurface } from "./material-behavior";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";
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
	type TexturePageAtlasPlan,
} from "./texture-pages/texture-page-atlas-planner";
import {
	deriveDirectGeometrySubmissionLayout,
	type GeometrySubmissionLayout,
} from "./webgl2/families/direct-render-family";
import {
	createWebgl2TextureAtlasGenerationResource,
	type Webgl2TextureAtlasGenerationResource,
} from "./webgl2/resources/texture-atlas-generation";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2CompactedGeometryFamilyResource,
} from "./webgl2/resources/compacted-geometry-resources";
import {
	releaseWebgl2CompactedGeometryBatchGraphLeases,
	syncWebgl2CompactedGeometryResources,
} from "./webgl2/resources/compacted-geometry-sync";
import {
	buildTerrainBlendPlanSet,
	type TerrainBlendPlan,
	type TerrainBlendTextureRef,
} from "./terrain-blend-plan";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";
import {
	collectDirectDrawTexturePageBindings,
	resolveDirectDrawBaseTexturePageBinding,
	type TexturePageBinding,
} from "./texture-pages/texture-page-binding";
import { deriveTerrainTileBatchBvhBinding } from "./non-instanced-bvh-bindings";
import {
	collectTerrainTileCompatibilityTextureKeys,
	describeTerrainTileGeometrySignature,
	describeTerrainTileGraphSignature,
	destroyWebgl2TerrainTileCompatibilityDraw,
	destroyWebgl2TerrainTileResource,
	terrainTileResourceId,
	type Webgl2TerrainBlendResources,
	type Webgl2TerrainTextureBinding,
	type Webgl2TerrainTileCompatibilityDrawResource,
	type Webgl2TerrainTileResource,
	type Webgl2TerrainTileReadiness,
} from "./webgl2/resources/terrain-tile-resources";

export interface Webgl2WorldDrawUnit {
	id: string;
	kind: StagedWorldDrawUnitAssembly["kind"];
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
	materialKind: StagedWorldDrawUnitAssembly["material"]["kind"];
	materialKey: string;
	materialFallbackReason: string | null;
	materialBehavior: LegacyMaterialBehaviorDto | null;
	directTextureSamplingPolicy: TextureSamplingPolicy | null;
	textureUploadSample: string | null;
	texturePageReadiness: StagedWorldMaterialTexturePageReadiness | null;
	compactionEligibility: CompactionEligibility;
	textureKey: string | null;
	texture: Webgl2Texture2DResource | null;
	indexedMaterial: Webgl2IndexedMaterialResources | null;
	detailOverlay: Webgl2DetailOverlayResources | null;
	terrainBlend: Webgl2TerrainBlendResources | null;
	texturePageBindings: readonly TexturePageBinding[];
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
	graphLeasesByDrawUnitId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByDrawUnitId: Map<string, string>;
	graphLeasesByTerrainTileId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByTerrainTileId: Map<string, string>;
	boundGraph: RendererResourceGraph | null;
	terrainTileCount: number;
	terrainTileCompatibilityDrawCount: number;
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
	atlasCompatibleDrawUnitCount: number;
	atlasPlacedRgbaDrawUnitCount: number;
	detailAtlasReadyDrawUnitCount: number;
	atlasFailureReasonCount: number;
	atlasFailureSamples: readonly string[];
	compactionFamilyPlan: CompactionFamilyPlan;
	texturePageAtlasPlan: TexturePageAtlasPlan;
	textureAtlasGeneration: Webgl2TextureAtlasGenerationResource | null;
	textureAtlasGenerationGraph: RendererResourceGraph | null;
	textureAtlasGenerationGraphLease: RendererResourceGraphLease | null;
	compactedGeometryBatches: Map<string, Webgl2CompactedGeometryBatchResource>;
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
	textureAtlasGenerationTextureCount: number;
	detailTextureAtlasGenerationTextureCount: number;
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

export interface Webgl2IndexedMaterialResources {
	key: string;
	indexFormat: ResolvedIndexedMaterialData["texture"]["format"];
	indexTextureKey: string;
	paletteTextureKey: string;
	indexTexture: Webgl2Texture2DResource;
	paletteTexture: Webgl2Texture2DResource;
	width: number;
	height: number;
	paletteColorCount: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
	clipThreshold: number;
}

const warnedUnsupportedDetailAtlasTextureKeys = new Set<string>();

export function createWebgl2WorldResourceStore(): Webgl2WorldResourceStore {
	return {
		drawUnits: [],
		drawUnitsById: new Map(),
		terrainTiles: [],
		terrainTilesById: new Map(),
		graphLeasesByDrawUnitId: new Map(),
		graphSignaturesByDrawUnitId: new Map(),
		graphLeasesByTerrainTileId: new Map(),
		graphSignaturesByTerrainTileId: new Map(),
		boundGraph: null,
		terrainTileCount: 0,
		terrainTileCompatibilityDrawCount: 0,
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
		atlasCompatibleDrawUnitCount: 0,
		atlasPlacedRgbaDrawUnitCount: 0,
		detailAtlasReadyDrawUnitCount: 0,
		atlasFailureReasonCount: 0,
		atlasFailureSamples: [],
		compactionFamilyPlan: createEmptyCompactionFamilyPlan(),
		texturePageAtlasPlan: createEmptyTexturePageAtlasPlan(),
		textureAtlasGeneration: null,
		textureAtlasGenerationGraph: null,
		textureAtlasGenerationGraphLease: null,
		compactedGeometryBatches: new Map(),
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
		textureAtlasGenerationTextureCount: 0,
		detailTextureAtlasGenerationTextureCount: 0,
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
				structuredInteriorScene,
				transitionPortalModel,
				renderChunkTransforms,
				materialTextureCapabilities,
				textureFilteringMode,
				detailTexturesEnabled,
				indexedMaterialDataCache: store.indexedMaterialDataCache,
				materialPlanCache: store.materialPlanCache,
			}),
	);
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
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
				materialTextureCapabilities,
				textureFilteringMode,
			});
			if (!terrainTile) {
				continue;
			}
			nextTerrainTiles.push(terrainTile);
			for (const textureKey of collectTerrainTileCompatibilityTextureKeys(
				terrainTile,
			)) {
				retainedTextureKeys.add(textureKey);
			}
		}
	});
	profileBrowserJsScope("webgl2.resource.createOrReuseDrawUnits", () => {
		for (const drawUnit of assembly.drawUnits) {
			const webgl2DrawUnit = createOrReuseWebgl2DrawUnit({
				assetState,
				gl,
				store,
				drawUnit,
				retainedDrawUnitIds,
				materialTextureCapabilities,
				textureFilteringMode,
			});
			nextDrawUnits.push(webgl2DrawUnit);
			if (webgl2DrawUnit.textureKey) {
				retainedTextureKeys.add(webgl2DrawUnit.textureKey);
			}
			for (const textureKey of collectTerrainBlendTextureKeys(webgl2DrawUnit)) {
				retainedTextureKeys.add(textureKey);
			}
			for (const textureKey of collectIndexedMaterialTextureKeys(
				webgl2DrawUnit,
			)) {
				retainedTextureKeys.add(textureKey);
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
	store.terrainTileCount = store.terrainTiles.length;
	store.terrainTileCompatibilityDrawCount = store.terrainTiles.reduce(
		(total, tile) => total + tile.compatibilityDraws.length,
		0,
	);
	store.terrainDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.kind === "terrain",
	).length;
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
		() =>
			planCompactionFamilies({
				drawUnits: store.drawUnits.map(toCompactionFamilyCandidate),
				policy: DEFAULT_WEBGL2_COMPACTION_FAMILY_PLANNING_POLICY,
			}),
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
		store.compactionFamilyPlan.bypasses.map(
			(bypass) => describeCompactionBypassBlockerSample(bypass, drawUnitById),
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
	syncWebgl2TextureAtlasGeneration({
		gl,
		store,
		plan: store.texturePageAtlasPlan,
		rendererResourceGraph,
	});
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
			drawUnit.indexedMaterial
				? [drawUnit.indexedMaterial.indexTextureKey]
				: [],
		),
	).size;
	store.paletteTextureCount = new Set(
		store.drawUnits.flatMap((drawUnit) =>
			drawUnit.indexedMaterial
				? [drawUnit.indexedMaterial.paletteTextureKey]
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
	store.drawUnits = [];
	store.drawUnitsById.clear();
	store.terrainTiles = [];
	store.terrainTilesById.clear();
	store.graphLeasesByDrawUnitId.clear();
	store.graphSignaturesByDrawUnitId.clear();
	store.graphLeasesByTerrainTileId.clear();
	store.graphSignaturesByTerrainTileId.clear();
	store.textureAtlasGenerationGraph = null;
	store.textureAtlasGenerationGraphLease = null;
	store.compactedGeometryBatchGraph = null;
	store.compactedGeometryBatchGraphLeasesByKey.clear();
	store.boundGraph = null;
	store.terrainTileCount = 0;
	store.terrainTileCompatibilityDrawCount = 0;
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
	for (const batch of store.compactedGeometryBatches.values()) {
		batch.dispose();
	}
	store.compactedGeometryBatches.clear();
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
	materialTextureCapabilities,
	textureFilteringMode,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	tile: TerrainSceneModel["tiles"][number];
	retainedTerrainTileIds: Set<string>;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2TerrainTileResource | null {
	const placement = deriveLandblockRenderChunkPlacement(tile.landblockId);
	const chunkOffset = chunkOffsetByKey.get(placement.chunkKey);
	if (!chunkOffset) {
		return null;
	}
	const geometry = buildStagedTerrainGeometry(tile.mesh);
	if (geometry.triangleCount === 0) {
		return null;
	}
	const id = terrainTileResourceId(tile);
	const readiness = deriveWebgl2TerrainTileReadiness(tile);
	const bvhBinding = deriveTerrainTileBatchBvhBinding(tile);
	const modelMatrix = createTranslationMat4({
		x: chunkOffset.x + tile.chunkLocalOffset.x,
		y: chunkOffset.y + tile.chunkLocalOffset.y,
		z: chunkOffset.z + tile.chunkLocalOffset.z,
	});
	const compatibilityDraws = createWebgl2TerrainTileCompatibilityDraws({
		assetState,
		gl,
		store,
		tile,
		materialTextureCapabilities,
		textureFilteringMode,
	});
	const geometrySignature = describeTerrainTileGeometrySignature(geometry);
	const previous = store.terrainTilesById.get(id);
	if (
		previous &&
		previous.geometrySignature === geometrySignature &&
		describeTerrainTileReadinessSignature(previous.readiness) ===
			describeTerrainTileReadinessSignature(readiness)
	) {
		for (const draw of previous.compatibilityDraws) {
			destroyWebgl2TerrainTileCompatibilityDraw(draw);
		}
		previous.label = tile.label;
		previous.placementKey = placement.chunkKey;
		previous.modelMatrix = modelMatrix;
		previous.readiness = readiness;
		previous.dataSource = tile.dataSource;
		previous.bvhItemKeys = [...bvhBinding.itemKeys];
		previous.bvhFallbackReason = bvhBinding.fallbackReason;
		previous.compatibilityDraws = compatibilityDraws;
		retainedTerrainTileIds.add(id);
		return previous;
	}
	if (previous) {
		destroyWebgl2TerrainTileResource(previous);
	}
	const buffers = createWebgl2IndexedGeometryBuffers(gl, {
		id,
		geometry,
	});
	const resource = {
		id,
		assetId: tile.assetId,
		landblockId: tile.landblockId,
		label: tile.label,
		placementKey: placement.chunkKey,
		geometrySignature,
		...buffers,
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		modelMatrix,
		readiness,
		dataSource: tile.dataSource,
		bvhItemKeys: [...bvhBinding.itemKeys],
		bvhFallbackReason: bvhBinding.fallbackReason,
		compatibilityDraws,
	} satisfies Webgl2TerrainTileResource;
	store.terrainTilesById.set(id, resource);
	retainedTerrainTileIds.add(id);
	return resource;
}

function createWebgl2TerrainTileCompatibilityDraws({
	assetState,
	gl,
	store,
	tile,
	materialTextureCapabilities,
	textureFilteringMode,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	tile: TerrainSceneModel["tiles"][number];
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2TerrainTileCompatibilityDrawResource[] {
	const planSet =
		tile.materialResources.status === "ready"
			? buildTerrainBlendPlanSet({
					assetState,
					regionNumber: tile.materialResources.regionNumber,
					pcodes: tile.mesh.quads.map((quad) => quad.pcode),
				})
			: null;
	if (!planSet) {
		const geometry = buildStagedTerrainGeometry(tile.mesh);
		if (geometry.triangleCount === 0) {
			return [];
		}
		return [
			createWebgl2TerrainTileCompatibilityDraw({
				gl,
				id: `${terrainTileResourceId(tile)}/compatibility-debug`,
				geometry,
				pcode: null,
				blend: null,
				preparedAssetIds: [tile.assetId],
			}),
		];
	}
	return planSet.plans.flatMap((plan) => {
		const geometry = buildStagedTerrainGeometry(tile.mesh, { pcode: plan.pcode });
		if (geometry.triangleCount === 0) {
			return [];
		}
		const blend = resolveWebgl2TerrainBlendPlanResources({
			assetState,
			gl,
			store,
			plan,
			hasUvs: geometry.uvs !== null,
			materialTextureCapabilities,
			textureFilteringMode,
		});
		if (!blend) {
			return [];
		}
		return [
			createWebgl2TerrainTileCompatibilityDraw({
				gl,
				id: `${terrainTileResourceId(tile)}/compatibility-pcode/${plan.pcode}`,
				geometry,
				pcode: plan.pcode,
				blend,
				preparedAssetIds: [
					tile.assetId,
					tile.materialResources.terrainMaterialAssetId,
					...collectTerrainBlendPlanPreparedAssetIds(plan),
				],
			}),
		];
	});
}

function createWebgl2TerrainTileCompatibilityDraw({
	gl,
	id,
	geometry,
	pcode,
	blend,
	preparedAssetIds,
}: {
	gl: WebGL2RenderingContext;
	id: string;
	geometry: ReturnType<typeof buildStagedTerrainGeometry>;
	pcode: number | null;
	blend: Webgl2TerrainBlendResources | null;
	preparedAssetIds: readonly string[];
}): Webgl2TerrainTileCompatibilityDrawResource {
	const geometrySignature = describeTerrainTileGeometrySignature(geometry);
	return {
		id,
		pcode,
		geometrySignature,
		...createWebgl2IndexedGeometryBuffers(gl, { id, geometry }),
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		blend,
		preparedAssetIds,
	};
}

function createWebgl2IndexedGeometryBuffers(
	gl: WebGL2RenderingContext,
	{
		id,
		geometry,
	}: {
		id: string;
		geometry: ReturnType<typeof buildStagedTerrainGeometry>;
	},
): Pick<
	Webgl2TerrainTileResource,
	"vertexArray" | "vertexBuffer" | "uvBuffer" | "indexBuffer" | "indexType"
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
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		vertexArray,
		vertexBuffer,
		uvBuffer,
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

function createOrReuseWebgl2DrawUnit({
	assetState,
	gl,
	store,
	drawUnit,
	retainedDrawUnitIds,
	materialTextureCapabilities,
	textureFilteringMode,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: StagedWorldDrawUnitAssembly;
	retainedDrawUnitIds: Set<string>;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
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
		previous.texturePageReadiness = resolveWebgl2DrawUnitTexturePageReadiness(drawUnit);
		previous.textureKey =
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.textureKey
				: drawUnit.material.kind === "indexed-paletted"
					? drawUnit.material.indexedMaterial.renderSurfaceAssetId
					: null;
		previous.texture = resolveWebgl2DrawUnitTexture({ gl, store, drawUnit });
		previous.indexedMaterial = resolveWebgl2IndexedMaterialResources({
			gl,
			store,
			drawUnit,
		});
		previous.detailOverlay = resolveWebgl2DetailOverlayResources({
			assetState,
			gl,
			store,
			drawUnit,
			materialTextureCapabilities,
			textureFilteringMode,
		});
		previous.terrainBlend = resolveWebgl2TerrainBlendResources({
			assetState,
			gl,
			store,
			drawUnit,
			materialTextureCapabilities,
			textureFilteringMode,
		});
		previous.texturePageBindings = collectDirectDrawTexturePageBindings({
			texture: previous.texture,
			indexedMaterial: previous.indexedMaterial,
			detailOverlay: previous.detailOverlay,
			terrainBlend: previous.terrainBlend,
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
			drawUnit.material.kind === "terrain-blend" ||
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
	const indexedMaterial = resolveWebgl2IndexedMaterialResources({
		gl,
		store,
		drawUnit,
	});
	const detailOverlay = resolveWebgl2DetailOverlayResources({
		assetState,
		gl,
		store,
		drawUnit,
		materialTextureCapabilities,
		textureFilteringMode,
	});
	const terrainBlend = resolveWebgl2TerrainBlendResources({
		assetState,
		gl,
		store,
		drawUnit,
		materialTextureCapabilities,
		textureFilteringMode,
	});
	const directTextureSamplingPolicy =
		resolveWebgl2DrawUnitDirectTextureSamplingPolicy(drawUnit);
	const texturePageReadiness = resolveWebgl2DrawUnitTexturePageReadiness(drawUnit);
	const texturePageBindings = collectDirectDrawTexturePageBindings({
		texture,
		indexedMaterial,
		detailOverlay,
		terrainBlend,
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
		indexedMaterial,
		detailOverlay,
		terrainBlend,
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
	drawUnit: StagedWorldDrawUnitAssembly,
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
	drawUnit: StagedWorldDrawUnitAssembly,
): Webgl2SceneDomain | null {
	switch (drawUnit.kind) {
		case "terrain":
			return "exterior";
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
	drawUnit: StagedWorldDrawUnitAssembly,
): number | null {
	switch (drawUnit.kind) {
		case "static":
		case "structured-interior":
			return drawUnit.owningLandblockId;
		case "terrain":
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
	const indexedMaterial = drawUnit.indexedMaterial;
	if (
		!indexedMaterial ||
		drawUnit.compactionEligibility.material.alphaPolicy !== "opaque"
	) {
		return null;
	}
	return {
		key: [
			"compacted-indexed-material",
			drawUnit.materialKey,
			indexedMaterial.indexTextureKey,
			indexedMaterial.paletteTextureKey,
			indexedMaterial.indexFormat,
			`clip=${indexedMaterial.clipThreshold}`,
			`wrap=${indexedMaterial.wrapS}/${indexedMaterial.wrapT}`,
			`detail=${drawUnit.detailOverlay?.atlasEntry?.key ?? "none"}`,
		].join("|"),
		sourceMaterialKey: drawUnit.materialKey,
		indexPageKey: indexedMaterial.indexTextureKey,
		palettePageKey: indexedMaterial.paletteTextureKey,
		indexFormat: indexedMaterial.indexFormat,
		indexPageWidth: indexedMaterial.width,
		indexPageHeight: indexedMaterial.height,
		paletteColorCount: indexedMaterial.paletteColorCount,
		clipThreshold: indexedMaterial.clipThreshold,
		wrapS: indexedMaterial.wrapS,
		wrapT: indexedMaterial.wrapT,
		color: drawUnit.color,
		detailAtlasEntryKey: drawUnit.detailOverlay?.atlasEntry?.key ?? null,
		detailTiling: drawUnit.detailOverlay?.tiling ?? 1,
		alphaPolicy: "opaque",
		filteringMode: "shader-palette-linear",
	};
}

function destroyWebgl2DrawUnit(drawUnit: Webgl2WorldDrawUnit): void {
	drawUnit.vertexArray.dispose();
	drawUnit.vertexBuffer.dispose();
	drawUnit.uvBuffer?.dispose();
	drawUnit.indexBuffer.dispose();
}

function resolveWebgl2MaterialFallbackReason(
	drawUnit: StagedWorldDrawUnitAssembly,
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
	if (drawUnit.material.kind === "terrain-blend" && !drawUnit.geometry.uvs) {
		return `webgl2 terrain blend ${drawUnit.material.key} has no UV buffer`;
	}
	return drawUnit.material.fallbackReason;
}

function resolveWebgl2DrawUnitDirectTextureSamplingPolicy(
	drawUnit: StagedWorldDrawUnitAssembly,
): TextureSamplingPolicy | null {
	return drawUnit.material.kind === "direct-texture"
		? drawUnit.material.textureUpload.upload.samplingPolicy
		: null;
}

function resolveWebgl2DrawUnitTextureUploadSample(
	drawUnit: StagedWorldDrawUnitAssembly,
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

function resolveWebgl2IndexedMaterialResources({
	gl,
	store,
	drawUnit,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: StagedWorldDrawUnitAssembly;
}): Webgl2IndexedMaterialResources | null {
	if (drawUnit.material.kind !== "indexed-paletted" || !drawUnit.geometry.uvs) {
		return null;
	}
	const indexedMaterial = drawUnit.material.indexedMaterial;
	const indexTextureKey = describeIndexedTextureKey(indexedMaterial);
	const paletteTextureKey = describeIndexedPaletteTextureKey(indexedMaterial);
	const indexTexture =
		store.texturesByKey.get(indexTextureKey) ??
		createAndStoreWebgl2Texture2D({
			gl,
			store,
			key: indexTextureKey,
			upload: toWebgl2IndexedTextureUpload(gl, indexedMaterial.texture),
			sampler: {
				wrapS:
					indexedMaterial.samplingPolicy.wrapS === "repeat"
						? gl.REPEAT
						: gl.CLAMP_TO_EDGE,
				wrapT:
					indexedMaterial.samplingPolicy.wrapT === "repeat"
						? gl.REPEAT
						: gl.CLAMP_TO_EDGE,
				minFilter: gl.NEAREST,
				magFilter: gl.NEAREST,
			},
		});
	const paletteTexture =
		store.texturesByKey.get(paletteTextureKey) ??
		createAndStoreWebgl2Texture2D({
			gl,
			store,
			key: paletteTextureKey,
			upload: {
				width: indexedMaterial.palette.colorCount,
				height: 1,
				internalFormat: gl.RGBA8,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
				data: indexedMaterial.palette.colorsRgba,
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
		key: drawUnit.material.key,
		indexFormat: indexedMaterial.texture.format,
		indexTextureKey,
		paletteTextureKey,
		indexTexture,
		paletteTexture,
		width: indexedMaterial.texture.width,
		height: indexedMaterial.texture.height,
		paletteColorCount: indexedMaterial.palette.colorCount,
		wrapS: indexedMaterial.samplingPolicy.wrapS,
		wrapT: indexedMaterial.samplingPolicy.wrapT,
		clipThreshold: isBase1ClipMapSurface(indexedMaterial.recipe.surfaceType)
			? 8
			: -1,
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
	drawUnit: StagedWorldDrawUnitAssembly,
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
	drawUnit: StagedWorldDrawUnitAssembly;
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
	drawUnit: StagedWorldDrawUnitAssembly;
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
	if (overlay.blendMode !== "dst-color") {
		return null;
	}
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
		blendMode: "dst-color",
	};
}

function resolveWebgl2TerrainBlendResources({
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
	drawUnit: StagedWorldDrawUnitAssembly;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2TerrainBlendResources | null {
	if (drawUnit.material.kind !== "terrain-blend" || !drawUnit.geometry.uvs) {
		return null;
	}
	return resolveWebgl2TerrainBlendPlanResources({
		assetState,
		gl,
		store,
		plan: drawUnit.material.plan,
		hasUvs: drawUnit.geometry.uvs !== null,
		materialTextureCapabilities,
		textureFilteringMode,
	});
}

function resolveWebgl2TerrainBlendPlanResources({
	assetState,
	gl,
	store,
	plan,
	hasUvs,
	materialTextureCapabilities,
	textureFilteringMode,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: TerrainBlendPlan;
	hasUvs: boolean;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2TerrainBlendResources | null {
	if (!hasUvs) {
		return null;
	}
	const base = resolveWebgl2TerrainTextureBinding({
		assetState,
		gl,
		store,
		ref: plan.base,
		materialTextureCapabilities,
		textureFilteringMode,
	});
	if (!base) {
		return null;
	}
	return {
		plan,
		base,
		overlays: plan.overlays.flatMap((overlay) => {
			const terrain = resolveWebgl2TerrainTextureBinding({
				assetState,
				gl,
				store,
				ref: overlay.terrain,
				materialTextureCapabilities,
				textureFilteringMode,
			});
			const alpha = resolveWebgl2TerrainTextureBinding({
				assetState,
				gl,
				store,
				ref: overlay.alpha,
				materialTextureCapabilities,
				textureFilteringMode,
			});
			return terrain && alpha
				? [{ terrain, alpha, rotation: overlay.rotation }]
				: [];
		}),
		roads: plan.roads.flatMap((road) => {
			const roadTexture = resolveWebgl2TerrainTextureBinding({
				assetState,
				gl,
				store,
				ref: road.road,
				materialTextureCapabilities,
				textureFilteringMode,
			});
			const alpha = resolveWebgl2TerrainTextureBinding({
				assetState,
				gl,
				store,
				ref: road.alpha,
				materialTextureCapabilities,
				textureFilteringMode,
			});
			return roadTexture && alpha
				? [{ road: roadTexture, alpha, rotation: road.rotation }]
				: [];
		}),
	};
}

function collectTerrainBlendPlanPreparedAssetIds(
	plan: TerrainBlendPlan,
): readonly string[] {
	return uniqueSortedStrings([
		...terrainTextureAssetIds(plan.base),
		...plan.overlays.flatMap((overlay) => [
			...terrainTextureAssetIds(overlay.terrain),
			...terrainTextureAssetIds(overlay.alpha),
		]),
		...plan.roads.flatMap((road) => [
			...terrainTextureAssetIds(road.road),
			...terrainTextureAssetIds(road.alpha),
		]),
	]);
}

function terrainTextureAssetIds(
	texture: TerrainBlendPlan["base"],
): readonly string[] {
	return [
		texture.textureAssetId,
		`render-surface/${formatHex32(texture.renderSurface.renderSurfaceId)}`,
	];
}

function resolveWebgl2TerrainTextureBinding({
	assetState,
	gl,
	store,
	ref,
	materialTextureCapabilities,
	textureFilteringMode,
}: {
	assetState: AssetChannelState;
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	ref: TerrainBlendTextureRef;
	materialTextureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode: TextureFilteringMode;
}): Webgl2TerrainTextureBinding | null {
	const samplingPolicy = selectRenderSurfaceTextureSamplingPolicy(
		ref.renderSurface,
		createDefaultMaterialTextureSamplingPolicy(
			materialTextureCapabilities,
			textureFilteringMode,
		),
	);
	const key = describeWebgl2DirectRenderSurfaceTextureKey(
		ref.renderSurface,
		samplingPolicy,
	);
	const cached = store.texturesByKey.get(key);
	if (cached) {
		return {
			key,
			texture: cached,
			tiling: ref.tiling,
			wrapS: ref.wrap,
			wrapT: ref.wrap,
		};
	}
	const upload = prepareTerrainTextureUpload(
		assetState,
		ref,
		materialTextureCapabilities,
		textureFilteringMode,
	);
	if (upload?.status !== "ready" || upload.upload.kind !== "direct") {
		return null;
	}
	const texture = profileBrowserJsScope("webgl2.texture.upload.terrain", () =>
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
		tiling: ref.tiling,
		wrapS: ref.wrap,
		wrapT: ref.wrap,
	};
}

function prepareTerrainTextureUpload(
	assetState: AssetChannelState,
	ref: TerrainBlendTextureRef,
	materialTextureCapabilities: MaterialTextureCapabilities,
	textureFilteringMode: TextureFilteringMode,
): (RenderSurfaceTextureUploadPreparation & { status: "ready" }) | null {
	const defaultPolicy = selectRenderSurfaceTextureSamplingPolicy(
		ref.renderSurface,
		createDefaultMaterialTextureSamplingPolicy(
			materialTextureCapabilities,
			textureFilteringMode,
		),
	);
	const samplingPolicy = {
		...defaultPolicy,
		wrapS: ref.wrap,
		wrapT: ref.wrap,
		colorSpace: ref.role === "mask" ? "none" : defaultPolicy.colorSpace,
	} satisfies TextureSamplingPolicy;
	const upload = prepareRenderSurfaceTextureUploadData(
		ref.renderSurface,
		samplingPolicy,
		materialTextureCapabilities,
		resolvePreparedTextureForRenderSurface(assetState, ref.renderSurface),
	);
	return upload.status === "ready" ? upload : null;
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

function collectTerrainBlendTextureKeys(
	drawUnit: Webgl2WorldDrawUnit,
): readonly string[] {
	if (!drawUnit.terrainBlend) {
		return [];
	}
	return [
		drawUnit.terrainBlend.base.key,
		...drawUnit.terrainBlend.overlays.flatMap((overlay) => [
			overlay.terrain.key,
			overlay.alpha.key,
		]),
		...drawUnit.terrainBlend.roads.flatMap((road) => [
			road.road.key,
			road.alpha.key,
		]),
	];
}

function collectIndexedMaterialTextureKeys(
	drawUnit: Webgl2WorldDrawUnit,
): readonly string[] {
	if (!drawUnit.indexedMaterial) {
		return [];
	}
	return [
		drawUnit.indexedMaterial.indexTextureKey,
		drawUnit.indexedMaterial.paletteTextureKey,
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
						...collectTerrainBlendTextureKeys(drawUnit),
						...collectIndexedMaterialTextureKeys(drawUnit),
						...(drawUnit.detailOverlay ? [drawUnit.detailOverlay.key] : []),
					]
				: [
						...collectTerrainBlendTextureKeys(drawUnit),
						...collectIndexedMaterialTextureKeys(drawUnit),
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
	bypass: { drawUnitId: string; reason: string; blockerKind: string; blocker: string },
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
	bindings: readonly TexturePageBinding[],
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
	drawUnit: StagedWorldDrawUnitAssembly,
): string {
	return [
		drawUnit.kind,
		drawUnit.material.kind,
		drawUnit.material.key,
		`v${drawUnit.geometry.vertexCount}`,
		`t${drawUnit.geometry.triangleCount}`,
		`p${hashFloat32Array(drawUnit.geometry.positions)}`,
		`u${drawUnit.geometry.uvs ? hashFloat32Array(drawUnit.geometry.uvs) : "none"}`,
		`i${hashIndexArray(drawUnit.geometry.indices)}`,
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
		if (drawUnit.indexedMaterial) {
			return [
				describeIndexedTexturePageSamplingPolicy(
					drawUnit.indexedMaterial.wrapS,
					drawUnit.indexedMaterial.wrapT,
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
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: TexturePageAtlasPlan;
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	if (
		store.textureAtlasGenerationGraph &&
		store.textureAtlasGenerationGraph !== rendererResourceGraph
	) {
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
	}
	if (!requiresTextureAtlasGeneration(plan)) {
		store.textureAtlasGeneration?.dispose();
		store.textureAtlasGeneration = null;
		store.textureAtlasGenerationTextureCount = 0;
		store.detailTextureAtlasGenerationTextureCount = 0;
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
		return;
	}
	if (store.textureAtlasGeneration?.key !== plan.key) {
		const nextGeneration = profileBrowserJsScope(
			"webgl2.resource.createTextureAtlasGeneration",
			() =>
				createWebgl2TextureAtlasGenerationResource({
					gl,
					plan,
				}),
		);
		if (!nextGeneration) {
			throw new Error(
				`Texture page atlas plan ${plan.key} has atlas-ready draw units but produced no generation.`,
			);
		}
		store.textureAtlasGeneration?.dispose();
		store.textureAtlasGeneration = nextGeneration;
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
	} else if (store.textureAtlasGeneration) {
		store.textureAtlasGeneration = refreshWebgl2TextureAtlasGenerationCoverage({
			generation: store.textureAtlasGeneration,
			plan,
		});
	}
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
				label: "outdoor static atlas",
				metadata: {
					textureCount: generation.textures.length,
					drawUnitCount: generation.rgbaAtlasReadyDrawUnitIds.length,
				},
			},
			...generation.preparedTextureAssetIds.map((assetId, index) => ({
				key: preparedNodeKeys[index],
				kind: "prepared-asset" as const,
				label: assetId,
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
					label: record.label,
					metadata: {
						drawUnitId: record.drawUnitId,
						materialKind: record.material.kind,
					},
				},
				{
					key: materialNodeKey,
					kind: "material-decision",
					label: record.material.key,
					metadata: {
						materialKind: record.material.kind,
						fallback: record.material.fallbackReason ?? null,
					},
				},
				...assetIds.map((assetId, index) => ({
					key: preparedNodeKeys[index],
					kind: "prepared-asset" as const,
					label: assetId,
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
				...resource.compatibilityDraws.flatMap(
					(draw) => draw.preparedAssetIds,
				),
				...(resource.readiness.status === "ready"
					? [resource.readiness.terrainMaterialAssetId]
					: []),
			]);
			const preparedNodeKeys = assetIds.map(preparedAssetGraphNodeKey);
			nodes.push(
				{
					key: sceneNodeKey,
					kind: "scene-object",
					label: `terrain tile ${resource.label}`,
					metadata: {
						resourceKind: "terrain-tile",
						terrainTileId: resource.id,
						landblockId: formatHex32(resource.landblockId),
						readiness: resource.readiness.status,
						compatibilityDrawCount: resource.compatibilityDraws.length,
					},
				},
				...assetIds.map((assetId, index) => ({
					key: preparedNodeKeys[index],
					kind: "prepared-asset" as const,
					label: assetId,
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

function hashFloat32Array(values: Float32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(
		values.buffer,
		values.byteOffset,
		values.byteLength,
	);
	for (let byteOffset = 0; byteOffset < view.byteLength; byteOffset += 1) {
		hash ^= view.getUint8(byteOffset);
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function hashIndexArray(values: Uint16Array | Uint32Array): string {
	let hash = 0x811c9dc5;
	for (const value of values) {
		hash ^= value;
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function toUnsignedHex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
