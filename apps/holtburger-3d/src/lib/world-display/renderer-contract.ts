import type { SceneCameraFrame, SceneBoundsFrame } from "./camera";

export type WorldDisplayRenderStyle = "solid" | "wireframe" | "no-material";
export type WorldDisplayTextureFilteringMode =
	| "nearest"
	| "linear"
	| "anisotropic-4x";
export type WorldDisplayTextureColorSpaceMode =
	| "auto"
	| "srgb"
	| "linear"
	| "compressed-linear";

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
	renderPassCount: number;
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
	textureColorSpaceMode: WorldDisplayTextureColorSpaceMode;
	detailTexturesEnabled: boolean;
	textureSamplingPolicyCounts: Record<string, number>;
	textureSamplingPolicySamples: string[];
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
