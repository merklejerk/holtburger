import type { SceneCameraFrame, SceneBoundsFrame } from "./camera";

export type WorldDisplayRenderStyle = "solid" | "wireframe" | "no-material";
export type WorldDisplayTextureFilteringMode =
	| "nearest"
	| "linear"
	| "anisotropic-4x";

export interface WorldRenderMetrics {
	bounds: SceneBoundsFrame | null;
	cameraFrame: SceneCameraFrame | null;
	performance: WorldRenderPerformanceMetrics | null;
	portal: WorldRenderPortalMetrics;
	debug: WorldRenderDebugMetrics;
	geometry: {
		terrainTileCount: number;
		terrainVertexCount: number;
		terrainTriangleCount: number;
		staticRenderablePartCount: number;
		staticRenderableInstancedGroupCount: number;
		structuredInteriorCellCount: number;
		structuredInteriorVertexCount: number;
		structuredInteriorTriangleCount: number;
	};
}

interface WorldRenderPerformanceMetrics {
	fps: number;
	frameMs: number;
	renderMs: number;
}

interface WorldRenderPortalMetrics {
	topologyOutdoorPortalCount: number;
	apertureCandidateCount: number;
	renderWorkItemCandidateCount: number;
	visiblePortalWorkItemCount: number;
	maskedInteriorCellCount: number;
	skippedMissingApertureCount: number;
	skippedMissingPolygonCount: number;
	skippedOutsideFrustumCount: number;
	skippedBackFacingCount: number;
	skippedTooSmallCount: number;
	screenAreaBuckets: {
		lt16: number;
		lt64: number;
		lt256: number;
		gte256: number;
	};
	minVisibleScreenAreaPx: number | null;
	maxVisibleScreenAreaPx: number | null;
}

interface WorldRenderDebugMetrics {
	rendererBackend: "webgl2";
	canvasWidth: number;
	canvasHeight: number;
	pixelRatio: number;
	cameraViewResidency: string;
	residencyCellCount: number;
	residencyLandblockCount: number;
	residencyAabbCandidateCount: number;
	residencyCellBspMatchCount: number;
	residencyAabbFallbackCount: number;
	residencySource: string;
	resourcePolicy: string;
	baseSceneDomain: string;
	transitionPortalMaxDepth: number;
	cameraNear: number | null;
	cameraFar: number | null;
	cameraFarNearRatio: number | null;
	renderPassCount: number;
	clearCount: number;
	portalRenderWorkItemCount: number;
	transitionApertureMaskPassCount: number;
	apertureDepthResetPassCount: number;
	interiorCompositePassCount: number;
	exteriorCompositePassCount: number;
	transitionPortalCandidateCount: number;
	portalApertureMeshCount: number;
	terrainMeshCount: number;
	visibleTerrainMeshCount: number;
	visibleTerrainTileCount: number;
	visibleTerrainOneDrawReadyTileCount: number;
	visibleTerrainOneDrawBlockedTileCount: number;
	visibleTerrainDrawSliceReadyCount: number;
	terrainOneDrawShaderDrawCallCount: number;
	terrainOneDrawSubmittedTileCount: number;
	terrainDrawSliceSubmittedCount: number;
	terrainOneDrawSubmittedTriangleCount: number;
	terrainOneDrawBlockerSamples: string[];
	terrainOneDrawSubmitFallbackSamples: string[];
	terrainAtlasRefCount: number;
	terrainAtlasCandidateCount: number;
	terrainAtlasBlockerTileCount: number;
	staticLandblockProductCount: number;
	staticBundleProductResourceCount: number;
	staticBundleLayerResourceCount: number;
	staticBundleLayerTexturePageResourceCount: number;
	structuredInteriorProductResourceCount: number;
	structuredInteriorCellResourceCount: number;
	structuredInteriorTexturePageResourceCount: number;
	structuredInteriorMaterialRecordResourceCount: number;
	terrainProductResourceCount: number;
	productTerrainTexturePageCount: number;
	portalMaskProductResourceCount: number;
	transitionPortalMaskResourceCount: number;
	staticGroupMeshCount: number;
	visibleStaticGroupMeshCount: number;
	staticRenderBatchCount: number;
	staticBvhCandidateBatchCount: number;
	staticBvhRepresentedInstanceKeyCount: number;
	staticBvhVisibleInstanceKeyCount: number;
	staticBvhFallbackIncludedBatchCount: number;
	terrainRenderBatchCount: number;
	terrainBvhCandidateBatchCount: number;
	structuredInteriorRenderBatchCount: number;
	structuredInteriorBvhCandidateBatchCount: number;
	debugOverlayRenderBatchCount: number;
	debugOverlayBvhCandidateBatchCount: number;
	portalMaskRenderBatchCount: number;
	portalMaskBvhCandidateBatchCount: number;
	nonStaticBvhFallbackIncludedBatchCount: number;
	portalCompositeVisibleItemKeyCount: number;
	portalCompositeStaticCandidateBatchCount: number;
	portalCompositeTerrainCandidateBatchCount: number;
	portalCompositeInteriorCandidateBatchCount: number;
	portalCompositeFallbackIncludedBatchCount: number;
	sceneDomainTargetWidth: number;
	sceneDomainTargetHeight: number;
	sceneDomainFramebufferFailureCount: number;
	sceneDomainFramebufferFailureSamples: string[];
	sceneDomainBaseCopyPassCount: number;
	sceneDomainExteriorDrawCallCount: number;
	sceneDomainInteriorDrawCallCount: number;
	portalCompositeRectCount: number;
	portalCompositeEstimatedPixelArea: number;
	portalCompositeMaxDepth: number;
	structuredInteriorMeshCount: number;
	visibleStructuredInteriorMeshCount: number;
	terrainBvhVisibleItemCount: number;
	terrainBvhTotalItemCount: number;
	outdoorStaticBvhVisibleItemCount: number;
	outdoorStaticBvhTotalItemCount: number;
	envCellLocalBvhVisibleItemCount: number;
	envCellLocalBvhTotalItemCount: number;
	visibleStaticInstanceKeyCount: number;
	visiblePortalKeyCount: number;
	envCellBvhConsideredCount: number;
	fallbackReasonCount: number;
	fallbackReasonSamples: string[];
	queryTimeMs: number;
	debugOverlayObjectCount: number;
	visibleDebugOverlayObjectCount: number;
	materialCount: number;
	materialProgramKeyCount: number;
	transparentMaterialCount: number;
	textureFilteringMode: WorldDisplayTextureFilteringMode;
	detailTexturesEnabled: boolean;
	textureSamplingPolicyCounts: Record<string, number>;
	texturePageBindingCount: number;
	texturePageUsageBucketCounts: Record<string, number>;
	texturePageSampleClassCounts: Record<string, number>;
	texturePageReadyMaterialCount: number;
	atlasCandidateEntryCount: number;
	atlasCandidateMaterialSlotCount: number;
	atlasFailureReasonCount: number;
	atlasFailureSamples: string[];
	terrainTexturePageCount: number;
	terrainDetailTexturePageCount: number;
	visibleStaticBundleLayerCount: number;
	staticBundleLayerSubmittedCount: number;
	staticBundleGeometryCandidateCount: number;
	staticBundleGeometrySubmittedCount: number;
	staticBundleDrawCallCount: number;
	staticBundleTriangleCount: number;
	staticBundleSkippedGeometryCount: number;
	staticBundleSubmitFallbackSamples: string[];
	textureVelocityPartCount: number;
	textureVelocityRenderGroupCount: number;
	textureVelocityMaterialCount: number;
	textureVelocitySignatureCount: number;
	textureVelocitySignatureSamples: string[];
	textureResourceCount: number;
	indexedTextureResourceCount: number;
	paletteResourceCount: number;
	staticGeometryGroupCount: number;
	staticVisibleGeometryGroupCount: number;
	structuredInteriorGeometryGroupCount: number;
	materialTypeCounts: Record<string, number>;
	materialProgramKeySamples: string[];
	preparedTextureUploadCount: number;
	preparedTextureGeneratedByteLength: number;
	compressedSingleLevelFallbackUploadCount: number;
	renderCalls: number;
	renderTriangles: number;
	renderLines: number;
	renderPoints: number;
}

export interface BrowserCameraResidency {
	kind: "outdoor-landblock" | "env-cell" | "unknown";
	landblockId: number | null;
	envCellId: number | null;
	source: "cell-bsp" | "aabb-fallback" | "outdoor" | "unknown";
}

export type WorldRenderMetricsChangeHandler = (
	metrics: WorldRenderMetrics,
) => void;

export type WorldRenderCameraFrameChangeHandler = (
	cameraFrame: SceneCameraFrame,
) => void;

export type BrowserCameraResidencyChangeHandler = (
	residency: BrowserCameraResidency,
) => void;
