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

export interface WorldRenderPortalMetrics {
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

export interface WorldRenderDebugMetrics {
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
	renderGraphPolicy: string;
	renderGraphBaseScene: string;
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
	sceneDomainExteriorDrawUnitCount: number;
	sceneDomainInteriorDrawUnitCount: number;
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
	atlasEligibleMaterialCount: number;
	atlasCandidateEntryCount: number;
	atlasCandidateMaterialSlotCount: number;
	bakedCandidateDrawUnitCount: number;
	bakedBypassReasonCount: number;
	bakedBypassSamples: string[];
	bakedCoverageDrawUnitCounts: Record<string, number>;
	bakedCoverageMaterialBlockerCounts: Record<string, number>;
	bakedCoverageGeometryBlockerCounts: Record<string, number>;
	bakedCoverageMaterialFamilyCounts: Record<string, number>;
	bakedCoverageMaterialAlphaPolicyCounts: Record<string, number>;
	bakedCoverageMaterialFamilyAlphaPolicyCounts: Record<string, number>;
	bakedCoverageRetainedDirectMaterialFamilyCounts: Record<string, number>;
	bakedCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts: Record<
		string,
		number
	>;
	bakedCoverageVisibleRetainedDirectMaterialFamilyCounts: Record<string, number>;
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
	bakedResourceFallbackSamples: string[];
	bakedShaderDrawCallCount: number;
	bakedSubmittedBatchCount: number;
	bakedSubmittedDrawSliceCount: number;
	bakedSubmittedSliceRepresentedDrawUnitCount: number;
	bakedSubmittedTriangleCount: number;
	bakedReplacedDrawUnitCount: number;
	bakedReplacedDrawUnitTriangleCount: number;
	bakedConservativeOverdrawTriangleCount: number;
	bakedConservativeOverdrawRatio: number;
	bakedRetainedDirectDrawUnitCount: number;
	bakedOriginalDrawCallEstimateCount: number;
	bakedSubmittedDrawCallEstimateCount: number;
	bakedDrawCallSavingsCount: number;
	bakedSubmitNoVisibleRouteCount: number;
	bakedSubmitNoVisibleExteriorRouteCount: number;
	bakedSubmitNoVisibleInteriorRouteCount: number;
	bakedSubmitNoVisibleOtherRouteCount: number;
	bakedSubmitFallbackSamples: string[];
	directTexturePageDrawCount: number;
	directSingleEntryTexturePageDrawCount: number;
	directPackedTexturePageDrawCount: number;
	directPackedTexturePageEstimatedBindAvoidedCount: number;
	directPackedTexturePageTextureCount: number;
	directTexturePageFallbackSamples: string[];
	stagedAtlasDrawCount: number;
	stagedAtlasStandaloneDirectDrawCount: number;
	stagedAtlasEstimatedTextureBindAvoidedCount: number;
	stagedAtlasSharedTextureAtlasTextureCount: number;
	stagedAtlasFallbackSamples: string[];
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
