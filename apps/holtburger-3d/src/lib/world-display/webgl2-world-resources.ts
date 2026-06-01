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
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type {
	IndexedMaterialDataCache,
	ResolvedIndexedMaterialData,
} from "./indexed-material-data";
import type { StagedWorldMaterialPlanCache } from "./staged-world-materials";
import type { ResolvedRegionDetailOverlayPlan } from "./region-detail-overlays";
import type { RenderMat4, RenderVec4 } from "./render-math";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	materialDecisionGraphNodeKey,
	atlasGenerationGraphNodeKey,
	preparedAssetGraphNodeKey,
	sceneObjectGraphNodeKey,
	staticBatchGraphNodeKey,
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
} from "./texture-sampling-policy";
import { type StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";
import {
	createEmptyAtlasBackedCompactionPlan,
	planAtlasBackedCompaction,
	type AtlasBackedCompactionDetailEntry,
	type AtlasBackedCompactionPlan,
	type AtlasBackedCompactionPolicy,
} from "./atlas-backed-compaction-planner";
import { buildAtlasBackedCompactedGeometry } from "./atlas-backed-compacted-geometry";
import {
	createWebgl2TextureAtlasGenerationResource,
	type Webgl2TextureAtlasGenerationResource,
} from "./webgl2-texture-atlas-generation";
import {
	createWebgl2AtlasBackedCompactedBatchResource,
	updateWebgl2AtlasBackedCompactedBatchDynamicTables,
	type Webgl2AtlasBackedCompactedBatchResource,
} from "./webgl2-atlas-backed-compacted-batches";
import type {
	TerrainBlendPlan,
	TerrainBlendTextureRef,
} from "./terrain-blend-plan";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";
import {
	collectDirectDrawTexturePageBindings,
	type TexturePageBinding,
} from "./texture-page-binding";

export interface Webgl2WorldDrawUnit {
	id: string;
	kind: StagedWorldDrawUnitAssembly["kind"];
	owningLandblockId: number | null;
	geometrySignature: string;
	submitOrderKey: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource | null;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	color: RenderVec4;
	materialKind: StagedWorldDrawUnitAssembly["material"]["kind"];
	materialKey: string;
	materialFallbackReason: string | null;
	materialBehavior: LegacyMaterialBehaviorDto | null;
	textureSamplingPolicy: string | null;
	textureUploadSample: string | null;
	atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
	atlasCandidateSample: string | null;
	textureKey: string | null;
	texture: Webgl2Texture2DResource | null;
	indexedMaterial: Webgl2IndexedMaterialResources | null;
	detailOverlay: Webgl2DetailOverlayResources | null;
	terrainBlend: Webgl2TerrainBlendResources | null;
	texturePageBindings: readonly TexturePageBinding[];
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
	graphLeasesByDrawUnitId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByDrawUnitId: Map<string, string>;
	boundGraph: RendererResourceGraph | null;
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
	textureSamplingPolicySamples: readonly string[];
	textureUploadSamples: readonly string[];
	texturePageBindingCount: number;
	texturePageUsageBucketCounts: Record<string, number>;
	texturePageSampleClassCounts: Record<string, number>;
	atlasEligibleMaterialCount: number;
	atlasCandidateEntryCount: number;
	atlasCandidateMaterialSlotCount: number;
	atlasCandidateSamples: readonly string[];
	atlasBackedCompactionPlan: AtlasBackedCompactionPlan;
	textureAtlasGeneration: Webgl2TextureAtlasGenerationResource | null;
	textureAtlasGenerationGraph: RendererResourceGraph | null;
	textureAtlasGenerationGraphLease: RendererResourceGraphLease | null;
	atlasBackedCompactedBatches: Map<
		string,
		Webgl2AtlasBackedCompactedBatchResource
	>;
	atlasBackedCompactedBatchGraph: RendererResourceGraph | null;
	atlasBackedCompactedBatchGraphLeasesByKey: Map<
		string,
		RendererResourceGraphLease
	>;
	bakedCandidateDrawUnitCount: number;
	bakedBypassReasonCount: number;
	bakedBypassSamples: readonly string[];
	textureAtlasGenerationTextureCount: number;
	detailTextureAtlasGenerationTextureCount: number;
	bakedGeometryBatchCount: number;
	bakedGeometryDrawUnitCount: number;
	bakedGeometryTriangleCount: number;
	bakedGeometryVertexByteLength: number;
	bakedGeometryIndexByteLength: number;
	bakedGeometryTotalByteLength: number;
	bakedGeometryDrawSliceCount: number;
	bakedGeometryBatchOriginCount: number;
	bakedGeometryTransformTableEntryCount: number;
	bakedResourceFallbackSamples: readonly string[];
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

export interface Webgl2TerrainBlendResources {
	plan: TerrainBlendPlan;
	base: Webgl2TerrainTextureBinding;
	overlays: readonly {
		terrain: Webgl2TerrainTextureBinding;
		alpha: Webgl2TerrainTextureBinding;
		rotation: number;
	}[];
	roads: readonly {
		road: Webgl2TerrainTextureBinding;
		alpha: Webgl2TerrainTextureBinding;
		rotation: number;
	}[];
}

export interface Webgl2DetailOverlayResources {
	key: string;
	texture: Webgl2Texture2DResource;
	tiling: number;
	blendMode: ResolvedRegionDetailOverlayPlan["blendMode"];
	atlasEntry: AtlasBackedCompactionDetailEntry | null;
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

export interface Webgl2TerrainTextureBinding {
	key: string;
	texture: Webgl2Texture2DResource;
	tiling: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
}

export function createWebgl2WorldResourceStore(): Webgl2WorldResourceStore {
	return {
		drawUnits: [],
		drawUnitsById: new Map(),
		graphLeasesByDrawUnitId: new Map(),
		graphSignaturesByDrawUnitId: new Map(),
		boundGraph: null,
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
		textureSamplingPolicySamples: [],
		textureUploadSamples: [],
		texturePageBindingCount: 0,
		texturePageUsageBucketCounts: {},
		texturePageSampleClassCounts: {},
		atlasEligibleMaterialCount: 0,
		atlasCandidateEntryCount: 0,
		atlasCandidateMaterialSlotCount: 0,
		atlasCandidateSamples: [],
		atlasBackedCompactionPlan: createEmptyAtlasBackedCompactionPlan(),
		textureAtlasGeneration: null,
		textureAtlasGenerationGraph: null,
		textureAtlasGenerationGraphLease: null,
		atlasBackedCompactedBatches: new Map(),
		atlasBackedCompactedBatchGraph: null,
		atlasBackedCompactedBatchGraphLeasesByKey: new Map(),
		bakedCandidateDrawUnitCount: 0,
		bakedBypassReasonCount: 0,
		bakedBypassSamples: [],
		textureAtlasGenerationTextureCount: 0,
		detailTextureAtlasGenerationTextureCount: 0,
		bakedGeometryBatchCount: 0,
		bakedGeometryDrawUnitCount: 0,
		bakedGeometryTriangleCount: 0,
		bakedGeometryVertexByteLength: 0,
		bakedGeometryIndexByteLength: 0,
		bakedGeometryTotalByteLength: 0,
		bakedGeometryDrawSliceCount: 0,
		bakedGeometryBatchOriginCount: 0,
		bakedGeometryTransformTableEntryCount: 0,
		bakedResourceFallbackSamples: [],
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
	const nextDrawUnits: Webgl2WorldDrawUnit[] = [];
	const retainedDrawUnitIds = new Set<string>();
	const retainedTextureKeys = new Set<string>();
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

	for (const [drawUnitId, drawUnit] of store.drawUnitsById) {
		if (!retainedDrawUnitIds.has(drawUnitId)) {
			destroyWebgl2DrawUnit(drawUnit);
			store.drawUnitsById.delete(drawUnitId);
		}
	}

	store.drawUnits = nextDrawUnits;
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
	const textureSamplingPolicies = store.drawUnits.flatMap((drawUnit) =>
		drawUnit.textureSamplingPolicy ? [drawUnit.textureSamplingPolicy] : [],
	);
	store.textureSamplingPolicyCounts = countStringOccurrences(
		textureSamplingPolicies,
	);
	store.textureSamplingPolicySamples = [
		...new Set(textureSamplingPolicies),
	].slice(0, 8);
	store.textureUploadSamples = [
		...collectTextureUploadSamples(store.drawUnits),
	];
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
	const atlasEligibleDrawUnits = store.drawUnits.filter(
		(drawUnit) => drawUnit.atlasEligibility !== null,
	);
	store.atlasEligibleMaterialCount = atlasEligibleDrawUnits.length;
	store.atlasCandidateEntryCount = new Set(
		atlasEligibleDrawUnits.flatMap((drawUnit) =>
			drawUnit.atlasEligibility
				? [drawUnit.atlasEligibility.atlasEntryKey]
				: [],
		),
	).size;
	store.atlasCandidateMaterialSlotCount = new Set(
		atlasEligibleDrawUnits.flatMap((drawUnit) =>
			drawUnit.atlasEligibility
				? [drawUnit.atlasEligibility.materialSlotKey]
				: [],
		),
	).size;
	store.atlasCandidateSamples = [
		...new Set(
			atlasEligibleDrawUnits.flatMap((drawUnit) =>
				drawUnit.atlasCandidateSample ? [drawUnit.atlasCandidateSample] : [],
			),
		),
	].slice(0, 8);
	store.atlasBackedCompactionPlan = profileBrowserJsScope(
		"webgl2.resource.planAtlasBackedCompaction",
		() =>
			planAtlasBackedCompaction({
				drawUnits: store.drawUnits.map(toAtlasBackedCompactionCandidate),
				policy: DEFAULT_WEBGL2_ATLAS_BACKED_COMPACTED_COMPACTION_POLICY,
			}),
	);
	store.bakedCandidateDrawUnitCount =
		store.atlasBackedCompactionPlan.compactableDrawUnitIds.length;
	store.bakedBypassReasonCount =
		store.atlasBackedCompactionPlan.bypasses.length;
	store.bakedBypassSamples = summarizeDiagnosticReasons(
		store.atlasBackedCompactionPlan.bypasses.map(
			(bypass) => `${bypass.reason}: ${bypass.detail}`,
		),
		8,
	);
	syncWebgl2TextureAtlasGeneration({
		gl,
		store,
		plan: store.atlasBackedCompactionPlan,
		rendererResourceGraph,
	});
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
	syncWebgl2AtlasBackedCompactedBatch({
		gl,
		store,
		plan: store.atlasBackedCompactionPlan,
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
	}
	releaseWebgl2TextureAtlasGenerationGraphLease(store);
	releaseWebgl2AtlasBackedCompactedBatchGraphLeases(store);
	for (const drawUnit of store.drawUnits) {
		destroyWebgl2DrawUnit(drawUnit);
	}
	store.drawUnits = [];
	store.drawUnitsById.clear();
	store.graphLeasesByDrawUnitId.clear();
	store.graphSignaturesByDrawUnitId.clear();
	store.textureAtlasGenerationGraph = null;
	store.textureAtlasGenerationGraphLease = null;
	store.atlasBackedCompactedBatchGraph = null;
	store.atlasBackedCompactedBatchGraphLeasesByKey.clear();
	store.boundGraph = null;
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
	store.textureSamplingPolicySamples = [];
	store.textureUploadSamples = [];
	store.texturePageBindingCount = 0;
	store.texturePageUsageBucketCounts = {};
	store.texturePageSampleClassCounts = {};
	store.atlasEligibleMaterialCount = 0;
	store.atlasCandidateEntryCount = 0;
	store.atlasCandidateMaterialSlotCount = 0;
	store.atlasCandidateSamples = [];
	store.atlasBackedCompactionPlan = createEmptyAtlasBackedCompactionPlan();
	store.textureAtlasGeneration?.dispose();
	store.textureAtlasGeneration = null;
	for (const batch of store.atlasBackedCompactedBatches.values()) {
		batch.dispose();
	}
	store.atlasBackedCompactedBatches.clear();
	store.bakedCandidateDrawUnitCount = 0;
	store.bakedBypassReasonCount = 0;
	store.bakedBypassSamples = [];
	store.textureAtlasGenerationTextureCount = 0;
	store.detailTextureAtlasGenerationTextureCount = 0;
	store.bakedGeometryBatchCount = 0;
	store.bakedGeometryDrawUnitCount = 0;
	store.bakedGeometryTriangleCount = 0;
	store.bakedGeometryVertexByteLength = 0;
	store.bakedGeometryIndexByteLength = 0;
	store.bakedGeometryTotalByteLength = 0;
	store.bakedGeometryDrawSliceCount = 0;
	store.bakedGeometryBatchOriginCount = 0;
	store.bakedGeometryTransformTableEntryCount = 0;
	store.bakedResourceFallbackSamples = [];
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

const DEFAULT_WEBGL2_ATLAS_BACKED_COMPACTED_COMPACTION_POLICY: AtlasBackedCompactionPolicy =
	{
		maxAtlasTextureSize: 4096,
		maxAtlasTextureCount: 8,
		baseGutterPixels: 2,
		maxMaterialSlotsPerDraw: 128,
	};

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
		previous.textureSamplingPolicy =
			resolveWebgl2DrawUnitTextureSamplingPolicy(drawUnit);
		previous.textureUploadSample =
			resolveWebgl2DrawUnitTextureUploadSample(drawUnit);
		previous.atlasEligibility = resolveWebgl2DrawUnitAtlasEligibility(drawUnit);
		previous.atlasCandidateSample =
			resolveWebgl2DrawUnitAtlasCandidateSample(drawUnit);
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
			textureSamplingPolicy: previous.textureSamplingPolicy,
			atlasEligibility: previous.atlasEligibility,
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
		textureSamplingPolicy: resolveWebgl2DrawUnitTextureSamplingPolicy(drawUnit),
		textureUploadSample: resolveWebgl2DrawUnitTextureUploadSample(drawUnit),
		atlasEligibility: resolveWebgl2DrawUnitAtlasEligibility(drawUnit),
		atlasCandidateSample: resolveWebgl2DrawUnitAtlasCandidateSample(drawUnit),
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
		texturePageBindings: collectDirectDrawTexturePageBindings({
			texture,
			indexedMaterial,
			detailOverlay,
			terrainBlend,
			textureSamplingPolicy:
				resolveWebgl2DrawUnitTextureSamplingPolicy(drawUnit),
			atlasEligibility: resolveWebgl2DrawUnitAtlasEligibility(drawUnit),
		}),
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

function toAtlasBackedCompactionCandidate(drawUnit: Webgl2WorldDrawUnit) {
	return {
		id: drawUnit.id,
		kind: drawUnit.kind,
		owningLandblockId: drawUnit.owningLandblockId,
		sceneDomain: drawUnit.sceneDomain,
		materialKind: drawUnit.materialKind,
		materialKey: drawUnit.materialKey,
		materialBehavior: drawUnit.materialBehavior,
		hasUvBuffer: drawUnit.uvBuffer !== null,
		hasDetailOverlay: drawUnit.detailOverlay !== null,
		detailAtlasEntry: drawUnit.detailOverlay?.atlasEntry ?? null,
		atlasEligibility: drawUnit.atlasEligibility,
		triangleCount: drawUnit.triangleCount,
		staticPartCount: drawUnit.staticPartCount,
		staticObjectKeys: drawUnit.staticObjectKeys,
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

function resolveWebgl2DrawUnitTextureSamplingPolicy(
	drawUnit: StagedWorldDrawUnitAssembly,
): string | null {
	return drawUnit.material.kind === "direct-texture"
		? describeTextureSamplingPolicy(
				drawUnit.material.textureUpload.upload.samplingPolicy,
			)
		: drawUnit.material.kind === "indexed-paletted"
			? describeTextureSamplingPolicy(
					drawUnit.material.indexedMaterial.samplingPolicy,
				)
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

function resolveWebgl2DrawUnitAtlasEligibility(
	drawUnit: StagedWorldDrawUnitAssembly,
): StagedWorldMaterialAtlasEligibility | null {
	return drawUnit.material.kind === "direct-texture"
		? drawUnit.material.atlasEligibility
		: null;
}

function resolveWebgl2DrawUnitAtlasCandidateSample(
	drawUnit: StagedWorldDrawUnitAssembly,
): string | null {
	const eligibility = resolveWebgl2DrawUnitAtlasEligibility(drawUnit);
	if (!eligibility) {
		return null;
	}
	return [
		drawUnit.kind,
		eligibility.materialSlotKey,
		`entry=${eligibility.atlasEntryKey}`,
		eligibility.renderStateKey,
		eligibility.samplingKey,
		`prepared=${eligibility.atlasEntry.preparedTextureAssetId}`,
	].join(" ");
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
			"[Holtburger 3D] Detail overlay texture is not RGBA8 atlas-compatible; compacted atlas-backed geometry will stage it separately.",
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
}): AtlasBackedCompactionDetailEntry | null {
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
	const plan = drawUnit.material.plan;
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

function collectTextureUploadSamples(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): readonly string[] {
	const samples = new Map<string, string>();
	for (const drawUnit of drawUnits) {
		if (!drawUnit.textureKey || samples.has(drawUnit.textureKey)) {
			continue;
		}
		samples.set(drawUnit.textureKey, describeDrawUnitTextureUpload(drawUnit));
		if (samples.size >= 8) {
			break;
		}
	}
	return [...samples.values()];
}

function describeDrawUnitTextureUpload(drawUnit: Webgl2WorldDrawUnit): string {
	if (drawUnit.indexedMaterial) {
		return [
			drawUnit.indexedMaterial.key,
			drawUnit.indexedMaterial.indexFormat,
			`${drawUnit.indexedMaterial.width}x${drawUnit.indexedMaterial.height}`,
			`palette=${drawUnit.indexedMaterial.paletteColorCount}`,
			"mips=deferred",
		].join(" ");
	}
	return (
		drawUnit.textureUploadSample ??
		`${drawUnit.textureKey ?? drawUnit.id}: unavailable`
	);
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

function syncWebgl2TextureAtlasGeneration({
	gl,
	store,
	plan,
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: AtlasBackedCompactionPlan;
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	if (
		store.textureAtlasGenerationGraph &&
		store.textureAtlasGenerationGraph !== rendererResourceGraph
	) {
		releaseWebgl2TextureAtlasGenerationGraphLease(store);
	}
	if (plan.compactableDrawUnitIds.length === 0) {
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
				`Atlas-backed compaction plan ${plan.key} has compactable draw units but produced no generation.`,
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

function refreshWebgl2TextureAtlasGenerationCoverage({
	generation,
	plan,
}: {
	generation: Webgl2TextureAtlasGenerationResource;
	plan: AtlasBackedCompactionPlan;
}): Webgl2TextureAtlasGenerationResource {
	if (
		stringArraysEqual(
			generation.compactableDrawUnitIds,
			plan.compactableDrawUnitIds,
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
		compactableDrawUnitIds: plan.compactableDrawUnitIds,
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
					drawUnitCount: generation.compactableDrawUnitIds.length,
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

function syncWebgl2AtlasBackedCompactedBatch({
	gl,
	store,
	plan,
	drawUnits,
	renderChunkTransforms,
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: AtlasBackedCompactionPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	if (
		store.atlasBackedCompactedBatchGraph &&
		store.atlasBackedCompactedBatchGraph !== rendererResourceGraph
	) {
		releaseWebgl2AtlasBackedCompactedBatchGraphLeases(store);
	}
	store.bakedResourceFallbackSamples = [];
	if (plan.compactableDrawUnitIds.length === 0) {
		disposeWebgl2AtlasBackedCompactedBatch(store);
		return;
	}
	if (!store.textureAtlasGeneration) {
		store.bakedResourceFallbackSamples = [
			`baked batch ${plan.key} waiting for texture atlas generation`,
		];
		disposeWebgl2AtlasBackedCompactedBatch(store);
		return;
	}
	const batchPlans = createAtlasBackedCompactedLandblockBatchPlans({
		plan,
		drawUnits,
		renderChunkTransforms,
	});
	if (batchPlans.length === 0) {
		store.bakedResourceFallbackSamples = [
			`baked batch ${plan.key} produced no compacted geometry`,
		];
		disposeWebgl2AtlasBackedCompactedBatch(store);
		return;
	}
	const retainedBatchKeys = new Set<string>();
	const placementsByEntryKey = createTextureAtlasPlacementsByEntryKey(plan);
	const detailPlacementsByEntryKey =
		createDetailTextureAtlasPlacementsByEntryKey(plan);
	for (const batchPlan of batchPlans) {
		const geometry = profileBrowserJsScope(
			"webgl2.resource.buildAtlasBackedCompactedGeometry",
			() =>
				buildAtlasBackedCompactedGeometry({
					plan: batchPlan.plan,
					drawUnits,
					batchOrigin: batchPlan.batchOrigin,
				}),
		);
		if (!geometry) {
			continue;
		}
		retainedBatchKeys.add(geometry.key);
		const previousBatch = store.atlasBackedCompactedBatches.get(geometry.key);
		if (!previousBatch) {
			const nextBatch = profileBrowserJsScope(
				"webgl2.resource.createAtlasBackedCompactedBatch",
				() =>
					createWebgl2AtlasBackedCompactedBatchResource({
						gl,
						geometry,
						landblockId: batchPlan.landblockId,
						materialSlots: batchPlan.plan.materialSlots,
						placementsByEntryKey,
						detailPlacementsByEntryKey,
					}),
			);
			store.atlasBackedCompactedBatches.set(nextBatch.key, nextBatch);
		} else {
			updateWebgl2AtlasBackedCompactedBatchDynamicTables(
				previousBatch,
				geometry,
			);
		}
	}
	for (const [batchKey, batch] of store.atlasBackedCompactedBatches) {
		if (!retainedBatchKeys.has(batchKey)) {
			batch.dispose();
			store.atlasBackedCompactedBatches.delete(batchKey);
			releaseWebgl2AtlasBackedCompactedBatchGraphLease(
				store,
				staticBatchGraphNodeKey(batchKey),
			);
		}
	}
	store.bakedGeometryBatchCount = store.atlasBackedCompactedBatches.size;
	store.bakedGeometryDrawUnitCount = sumAtlasBackedCompactedBatches(
		store,
		(batch) => batch.drawUnitCount,
	);
	store.bakedGeometryTriangleCount = sumAtlasBackedCompactedBatches(
		store,
		(batch) => batch.triangleCount,
	);
	store.bakedGeometryVertexByteLength = sumAtlasBackedCompactedBatches(
		store,
		(batch) =>
			batch.positionByteLength +
			batch.uvByteLength +
			batch.materialSlotByteLength,
	);
	store.bakedGeometryIndexByteLength = sumAtlasBackedCompactedBatches(
		store,
		(batch) => batch.indexByteLength,
	);
	store.bakedGeometryTotalByteLength = sumAtlasBackedCompactedBatches(
		store,
		(batch) => batch.totalByteLength,
	);
	store.bakedGeometryDrawSliceCount = sumAtlasBackedCompactedBatches(
		store,
		(batch) => batch.drawSliceCount,
	);
	store.bakedGeometryBatchOriginCount = store.atlasBackedCompactedBatches.size;
	store.bakedGeometryTransformTableEntryCount = 0;
	if (!rendererResourceGraph || store.atlasBackedCompactedBatches.size === 0) {
		releaseWebgl2AtlasBackedCompactedBatchGraphLeases(store);
		return;
	}
	store.atlasBackedCompactedBatchGraph = rendererResourceGraph;
	for (const batch of store.atlasBackedCompactedBatches.values()) {
		const batchNodeKey = staticBatchGraphNodeKey(batch.key);
		if (store.atlasBackedCompactedBatchGraphLeasesByKey.has(batchNodeKey)) {
			continue;
		}
		upsertWebgl2AtlasBackedCompactedBatchGraph({
			graph: rendererResourceGraph,
			batch,
			atlasGenerationKey: store.textureAtlasGeneration.key,
		});
		store.atlasBackedCompactedBatchGraphLeasesByKey.set(
			batchNodeKey,
			rendererResourceGraph.leaseNode(
				batchNodeKey,
				"webgl2 baked landblock batch",
			),
		);
	}
}

function upsertWebgl2AtlasBackedCompactedBatchGraph({
	graph,
	batch,
	atlasGenerationKey,
}: {
	graph: RendererResourceGraph;
	batch: Webgl2AtlasBackedCompactedBatchResource;
	atlasGenerationKey: string;
}): void {
	const batchNodeKey = staticBatchGraphNodeKey(batch.key);
	const atlasNodeKey = atlasGenerationGraphNodeKey(atlasGenerationKey);
	const sceneNodeKeys = uniqueSortedStrings(
		batch.drawSlices.flatMap((slice) => slice.drawUnitIds),
	).map(sceneObjectGraphNodeKey);
	graph.applyBatchUpdate({
		nodes: [
			{
				key: batchNodeKey,
				kind: "static-batch",
				label: `outdoor static atlas batch ${formatHex32(batch.landblockId)}`,
				metadata: {
					landblockId: formatHex32(batch.landblockId),
					drawUnitCount: batch.drawUnitCount,
					drawSliceCount: batch.drawSliceCount,
					triangleCount: batch.triangleCount,
					totalByteLength: batch.totalByteLength,
				},
			},
		],
		dependencyReplacements: [
			{
				nodeKey: batchNodeKey,
				dependencyKeys: [atlasNodeKey, ...sceneNodeKeys],
			},
		],
	});
}

function createTextureAtlasPlacementsByEntryKey(
	plan: AtlasBackedCompactionPlan,
) {
	return new Map(
		plan.atlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.atlasEntryKey, placement] as const,
			),
		),
	);
}

function createDetailTextureAtlasPlacementsByEntryKey(
	plan: AtlasBackedCompactionPlan,
) {
	return new Map(
		plan.detailAtlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.atlasEntryKey, placement] as const,
			),
		),
	);
}

function createAtlasBackedCompactedLandblockBatchPlans({
	plan,
	drawUnits,
	renderChunkTransforms,
}: {
	plan: AtlasBackedCompactionPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	renderChunkTransforms: readonly RenderChunkTransform[];
}): {
	landblockId: number;
	batchOrigin: RenderChunkTransform["offset"];
	plan: AtlasBackedCompactionPlan;
}[] {
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const chunkOffsetByLandblockId = new Map(
		renderChunkTransforms.map(
			(transform) => [transform.chunkLandblockId, transform.offset] as const,
		),
	);
	const drawUnitIdsByLandblockId = new Map<number, string[]>();
	for (const drawUnitId of plan.compactableDrawUnitIds) {
		const drawUnit = drawUnitById.get(drawUnitId);
		if (!drawUnit) {
			throw new Error(
				`Atlas-backed compaction plan references missing draw unit ${drawUnitId}.`,
			);
		}
		if (drawUnit.kind !== "static" && drawUnit.kind !== "structured-interior") {
			throw new Error(
				`Atlas compacted geometry plan references unsupported draw unit ${drawUnit.id} of kind ${drawUnit.kind}.`,
			);
		}
		const owningLandblockId = drawUnit.owningLandblockId;
		const group = drawUnitIdsByLandblockId.get(owningLandblockId) ?? [];
		group.push(drawUnit.id);
		drawUnitIdsByLandblockId.set(owningLandblockId, group);
	}
	return [...drawUnitIdsByLandblockId.entries()]
		.sort(([left], [right]) => left - right)
		.map(([landblockId, drawUnitIds]) => {
			const batchOrigin = chunkOffsetByLandblockId.get(landblockId);
			if (!batchOrigin) {
				throw new Error(
					`Atlas-backed compacted landblock batch ${formatHex32(landblockId)} has no render chunk origin.`,
				);
			}
			return {
				landblockId,
				batchOrigin,
				plan: createAtlasBackedCompactedLandblockBatchPlan({
					sourcePlan: plan,
					drawUnits,
					landblockId,
					drawUnitIds: drawUnitIds.sort(),
				}),
			};
		});
}

function createAtlasBackedCompactedLandblockBatchPlan({
	sourcePlan,
	drawUnits,
	landblockId,
	drawUnitIds,
}: {
	sourcePlan: AtlasBackedCompactionPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	landblockId: number;
	drawUnitIds: readonly string[];
}): AtlasBackedCompactionPlan {
	const drawUnitIdSet = new Set(drawUnitIds);
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const batchDrawUnits = drawUnitIds.map((drawUnitId) => {
		const drawUnit = drawUnitById.get(drawUnitId);
		if (!drawUnit) {
			throw new Error(
				`Atlas-backed compacted landblock batch ${formatHex32(landblockId)} references missing draw unit ${drawUnitId}.`,
			);
		}
		return drawUnit;
	});
	const sourceMaterialSlotByKey = new Map(
		sourcePlan.materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const sourceMaterialSlotKeyByDrawUnitId = new Map(
		sourcePlan.drawUnitMaterialSlots.map(
			(record) => [record.drawUnitId, record.materialSlotKey] as const,
		),
	);
	const batchMaterialSlotKeys = uniqueSortedStrings(
		batchDrawUnits.map((drawUnit) => {
			if (drawUnit.material.kind !== "direct-texture") {
				throw new Error(
					`Atlas-backed compacted landblock batch ${formatHex32(landblockId)} references non-direct material draw unit ${drawUnit.id}.`,
				);
			}
			return (
				sourceMaterialSlotKeyByDrawUnitId.get(drawUnit.id) ??
				drawUnit.material.atlasEligibility?.materialSlotKey ??
				""
			);
		}),
	);
	const localMaterialSlots = batchMaterialSlotKeys.map((slotKey, index) => {
		const sourceSlot = sourceMaterialSlotByKey.get(slotKey);
		if (!sourceSlot) {
			throw new Error(
				`Atlas-backed compacted landblock batch ${formatHex32(landblockId)} references missing material slot ${slotKey}.`,
			);
		}
		return { ...sourceSlot, index };
	});
	const localMaterialSlotByKey = new Map(
		localMaterialSlots.map((slot) => [slot.key, slot] as const),
	);
	const sourceSlices = sourcePlan.drawSlices
		.map((slice) => {
			const localDrawUnitIds = slice.drawUnitIds.filter((drawUnitId) =>
				drawUnitIdSet.has(drawUnitId),
			);
			const localMaterialSlotKeys = slice.materialSlotKeys.filter((slotKey) =>
				localMaterialSlotByKey.has(slotKey),
			);
			const localSlotIndices = localMaterialSlotKeys.map((slotKey) => {
				const slot = localMaterialSlotByKey.get(slotKey);
				if (!slot) {
					throw new Error(
						`Atlas-backed compacted landblock batch ${formatHex32(landblockId)} could not remap material slot ${slotKey}.`,
					);
				}
				return slot.index;
			});
			const materialTableSlotStart =
				localSlotIndices.length === 0 ? 0 : Math.min(...localSlotIndices);
			const materialTableSlotEnd =
				localSlotIndices.length === 0 ? 0 : Math.max(...localSlotIndices);
			return {
				...slice,
				key: `${slice.key}|landblock=${formatHex32(landblockId)}`,
				materialTableSlotStart,
				materialTableSlotCount:
					localSlotIndices.length === 0
						? 0
						: materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys: localMaterialSlotKeys,
				drawUnitIds: localDrawUnitIds,
			};
		})
		.filter((slice) => slice.drawUnitIds.length > 0);
	return {
		...sourcePlan,
		key: `${sourcePlan.key}|landblock=${formatHex32(landblockId)}`,
		compactableDrawUnitIds: drawUnitIds,
		materialSlots: localMaterialSlots,
		drawUnitMaterialSlots: sourcePlan.drawUnitMaterialSlots
			.filter((record) => drawUnitIdSet.has(record.drawUnitId))
			.map((record) => ({
				drawUnitId: record.drawUnitId,
				materialSlotKey: record.materialSlotKey,
			})),
		drawSlices: sourceSlices,
		staticObjectKeys: uniqueSortedStrings(
			batchDrawUnits.flatMap((drawUnit) => drawUnit.staticObjectKeys),
		),
		staticPartCount: batchDrawUnits.reduce(
			(total, drawUnit) => total + drawUnit.staticPartCount,
			0,
		),
		triangleCount: batchDrawUnits.reduce(
			(total, drawUnit) => total + drawUnit.geometry.triangleCount,
			0,
		),
	};
}

function sumAtlasBackedCompactedBatches(
	store: Webgl2WorldResourceStore,
	select: (batch: Webgl2AtlasBackedCompactedBatchResource) => number,
): number {
	return [...store.atlasBackedCompactedBatches.values()].reduce(
		(total, batch) => total + select(batch),
		0,
	);
}

function disposeWebgl2AtlasBackedCompactedBatch(
	store: Webgl2WorldResourceStore,
): void {
	for (const batch of store.atlasBackedCompactedBatches.values()) {
		batch.dispose();
	}
	store.atlasBackedCompactedBatches.clear();
	store.bakedGeometryBatchCount = 0;
	store.bakedGeometryDrawUnitCount = 0;
	store.bakedGeometryTriangleCount = 0;
	store.bakedGeometryVertexByteLength = 0;
	store.bakedGeometryIndexByteLength = 0;
	store.bakedGeometryTotalByteLength = 0;
	store.bakedGeometryDrawSliceCount = 0;
	store.bakedGeometryBatchOriginCount = 0;
	store.bakedGeometryTransformTableEntryCount = 0;
	releaseWebgl2AtlasBackedCompactedBatchGraphLeases(store);
}

function releaseWebgl2AtlasBackedCompactedBatchGraphLease(
	store: Webgl2WorldResourceStore,
	batchNodeKey: string,
): void {
	const lease =
		store.atlasBackedCompactedBatchGraphLeasesByKey.get(batchNodeKey);
	if (!lease) {
		return;
	}
	if (!store.atlasBackedCompactedBatchGraph) {
		throw new Error(
			"Atlas-backed compacted batch graph lease has no bound graph.",
		);
	}
	store.atlasBackedCompactedBatchGraph.releaseLease(lease);
	store.atlasBackedCompactedBatchGraphLeasesByKey.delete(batchNodeKey);
	if (store.atlasBackedCompactedBatchGraphLeasesByKey.size === 0) {
		store.atlasBackedCompactedBatchGraph = null;
	}
}

function releaseWebgl2AtlasBackedCompactedBatchGraphLeases(
	store: Webgl2WorldResourceStore,
): void {
	for (const batchNodeKey of [
		...store.atlasBackedCompactedBatchGraphLeasesByKey.keys(),
	]) {
		releaseWebgl2AtlasBackedCompactedBatchGraphLease(store, batchNodeKey);
	}
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
		}
		store.graphLeasesByDrawUnitId.clear();
		store.graphSignaturesByDrawUnitId.clear();
		store.boundGraph = null;
		return;
	}
	if (store.boundGraph && store.boundGraph !== graph) {
		for (const lease of store.graphLeasesByDrawUnitId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		store.graphLeasesByDrawUnitId.clear();
		store.graphSignaturesByDrawUnitId.clear();
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
