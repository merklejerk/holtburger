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
	texturePageReadyMaterialCount: number;
	atlasCandidateEntryCount: number;
	atlasCandidateMaterialSlotCount: number;
	atlasCompatibleDrawUnitCount: number;
	atlasPlacedRgbaDrawUnitCount: number;
	detailAtlasReadyDrawUnitCount: number;
	atlasFailureReasonCount: number;
	atlasFailureSamples: string[];
	compactionCandidateDrawUnitCount: number;
	compactionBypassReasonCount: number;
	compactionBypassSamples: string[];
	compactionBypassBlockerSamples: string[];
	compactionBypassDetailSamples: string[];
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
	compactionCoverageVisibleRetainedDirectMaterialFamilyCounts: Record<
		string,
		number
	>;
	textureAtlasGenerationTextureCount: number;
	detailTextureAtlasGenerationTextureCount: number;
	compactedGeometryFamilyResourceCounts: Record<string, number>;
	compactedGeometryBatchCount: number;
	compactedGeometryDrawUnitCount: number;
	compactedGeometryTriangleCount: number;
	compactedGeometryVertexByteLength: number;
	compactedGeometryIndexByteLength: number;
	compactedGeometryTotalByteLength: number;
	compactedGeometryDrawSliceCount: number;
	compactedGeometryBatchOriginCount: number;
	compactedGeometryTransformTableEntryCount: number;
	compactedResourceFallbackSamples: string[];
	rgbaTexturePageFamilyShaderDrawCallCount: number;
	rgbaTexturePageFamilySubmittedBatchCount: number;
	rgbaTexturePageFamilySubmittedDrawSliceCount: number;
	rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount: number;
	rgbaTexturePageFamilySubmittedTriangleCount: number;
	rgbaTexturePageFamilyReplacedDrawUnitCount: number;
	rgbaTexturePageFamilyReplacedDrawUnitTriangleCount: number;
	rgbaTexturePageFamilyConservativeOverdrawTriangleCount: number;
	rgbaTexturePageFamilyConservativeOverdrawRatio: number;
	rgbaTexturePageFamilyRetainedDirectDrawUnitCount: number;
	rgbaTexturePageFamilyOriginalDrawCallEstimateCount: number;
	rgbaTexturePageFamilySubmittedDrawCallEstimateCount: number;
	rgbaTexturePageFamilyDrawCallSavingsCount: number;
	rgbaTexturePageFamilyNoVisibleRouteCount: number;
	rgbaTexturePageFamilyNoVisibleExteriorRouteCount: number;
	rgbaTexturePageFamilyNoVisibleInteriorRouteCount: number;
	rgbaTexturePageFamilyNoVisibleOtherRouteCount: number;
	rgbaTexturePageFamilyFallbackSamples: string[];
	indexedPalettedFamilyShaderDrawCallCount: number;
	indexedPalettedFamilySubmittedBatchCount: number;
	indexedPalettedFamilySubmittedDrawSliceCount: number;
	indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount: number;
	indexedPalettedFamilySubmittedTriangleCount: number;
	indexedPalettedFamilyReplacedDrawUnitCount: number;
	indexedPalettedFamilyReplacedDrawUnitTriangleCount: number;
	indexedPalettedFamilyRetainedDirectDrawUnitCount: number;
	indexedPalettedFamilyNoVisibleRouteCount: number;
	retainedDirectOpaqueDrawUnitCount: number;
	retainedDirectBlendedDrawUnitCount: number;
	directTexturePageDrawCount: number;
	directSingleEntryTexturePageDrawCount: number;
	directPackedTexturePageDrawCount: number;
	directPackedTexturePageEstimatedBindAvoidedCount: number;
	directPackedTexturePageTextureCount: number;
	directTexturePageFallbackSamples: string[];
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
