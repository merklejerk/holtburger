import type { SceneBoundsFrame, SceneCameraFrame } from "./camera";
import type { WorldRenderFrameMetrics } from "./world-render-frame";
import type {
	WorldDisplayTextureFilteringMode,
	WorldRenderMetrics,
} from "./renderer-contract";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";
import type { Webgl2WorldSubmitMetrics } from "./webgl2-world-submit";
import type { Webgl2WorldResourceStore } from "./webgl2-world-resources";

export interface Webgl2RenderMetricsInput {
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	cameraFrame: SceneCameraFrame | null;
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
	clearCount: number;
	drawCallCount: number;
	lastFrameDrawCount: number;
	initializationError: string | null;
	worldStore: Webgl2WorldResourceStore | null;
	frameMetrics: WorldRenderFrameMetrics | null;
	submitMetrics: Webgl2WorldSubmitMetrics;
	portalRenderWorkItemCandidateCount: number;
	visiblePortalWorkItemCount: number;
	maskedInteriorCellCount: number;
	sceneDomainTargetWidth: number;
	sceneDomainTargetHeight: number;
	sceneDomainFramebufferFailureCount: number;
	sceneDomainFramebufferFailureSamples: readonly string[];
	sceneDomainBaseCopyPassCount: number;
	sceneDomainExteriorDrawCallCount: number;
	sceneDomainInteriorDrawCallCount: number;
	transitionApertureMaskPassCount: number;
	interiorCompositePassCount: number;
	exteriorCompositePassCount: number;
	portalCompositeRectCount: number;
	portalCompositeEstimatedPixelArea: number;
	portalCompositeMaxDepth: number;
	performance: WorldRenderMetrics["performance"];
	textureFilteringMode: WorldDisplayTextureFilteringMode;
	detailTexturesEnabled: boolean;
	sceneBounds: SceneBoundsFrame | null;
}

export function createWebgl2RenderMetrics(
	input: Webgl2RenderMetricsInput,
): WorldRenderMetrics {
	return {
		bounds: input.sceneBounds,
		cameraFrame: input.cameraFrame,
		performance: input.performance,
		portal: {
			topologyOutdoorPortalCount: 0,
			apertureCandidateCount: input.transitionPortalModel.candidates.length,
			renderWorkItemCandidateCount: input.portalRenderWorkItemCandidateCount,
			visiblePortalWorkItemCount: input.visiblePortalWorkItemCount,
			maskedInteriorCellCount: input.maskedInteriorCellCount,
			skippedMissingApertureCount: 0,
			skippedMissingPolygonCount: 0,
			skippedOutsideFrustumCount: 0,
			skippedBackFacingCount: 0,
			skippedTooSmallCount: 0,
			screenAreaBuckets: { lt16: 0, lt64: 0, lt256: 0, gte256: 0 },
			minVisibleScreenAreaPx: null,
			maxVisibleScreenAreaPx: null,
		},
		debug: {
			rendererBackend: "webgl2",
			canvasWidth: input.canvasWidth,
			canvasHeight: input.canvasHeight,
			pixelRatio: input.pixelRatio,
			cameraViewResidency: input.initializationError
				? "webgl2 initialization failed"
				: input.worldStore && input.worldStore.drawUnits.length > 0
					? input.cameraViewResidency
					: "webgl2 test frame",
			residencyCellCount: input.residencyCellCount,
			residencyLandblockCount: input.residencyLandblockCount,
			residencyAabbCandidateCount: input.residencyAabbCandidateCount,
			residencyCellBspMatchCount: input.residencyCellBspMatchCount,
			residencyAabbFallbackCount: input.residencyAabbFallbackCount,
			residencySource: input.residencySource,
			renderGraphPolicy: input.renderGraphPolicy,
			renderGraphBaseScene: input.renderGraphBaseScene,
			transitionPortalMaxDepth: input.transitionPortalMaxDepth,
			cameraNear: input.cameraNear,
			cameraFar: input.cameraFar,
			cameraFarNearRatio: input.cameraFarNearRatio,
			renderPassCount: input.clearCount,
			clearCount: input.clearCount,
			portalRenderWorkItemCount: input.visiblePortalWorkItemCount,
			transitionApertureMaskPassCount: input.transitionApertureMaskPassCount,
			apertureDepthResetPassCount: 0,
			interiorCompositePassCount: input.interiorCompositePassCount,
			exteriorCompositePassCount: input.exteriorCompositePassCount,
			transitionPortalCandidateCount:
				input.transitionPortalModel.candidates.length,
			portalApertureMeshCount: 0,
			terrainMeshCount: input.worldStore?.terrainTileCount ?? 0,
			visibleTerrainMeshCount:
				input.frameMetrics?.visibleDrawCountsByCategory.terrain ?? 0,
			visibleTerrainTileCount: input.submitMetrics.visibleTerrainTileCount,
			visibleTerrainOneDrawReadyTileCount:
				input.submitMetrics.visibleTerrainOneDrawReadyTileCount,
			visibleTerrainOneDrawBlockedTileCount:
				input.submitMetrics.visibleTerrainOneDrawBlockedTileCount,
			visibleTerrainDrawSliceReadyCount:
				input.submitMetrics.visibleTerrainDrawSliceReadyCount,
			terrainOneDrawShaderDrawCallCount:
				input.submitMetrics.terrainOneDrawShaderDrawCallCount,
			terrainOneDrawSubmittedTileCount:
				input.submitMetrics.terrainOneDrawSubmittedTileCount,
			terrainDrawSliceSubmittedCount:
				input.submitMetrics.terrainDrawSliceSubmittedCount,
			terrainOneDrawSubmittedTriangleCount:
				input.submitMetrics.terrainOneDrawSubmittedTriangleCount,
			terrainOneDrawBlockerSamples: [
				...input.submitMetrics.terrainOneDrawBlockerSamples,
			],
			terrainOneDrawSubmitFallbackSamples: [
				...input.submitMetrics.terrainOneDrawSubmitFallbackSamples,
			],
			terrainAtlasRefCount: input.worldStore?.terrainAtlasRefCount ?? 0,
			terrainAtlasCandidateCount:
				input.worldStore?.terrainAtlasCandidateCount ?? 0,
			terrainAtlasBlockerTileCount:
				input.worldStore?.terrainAtlasBlockerTileCount ?? 0,
			staticGroupMeshCount: input.worldStore?.appearancePreviewDrawUnitCount ?? 0,
			visibleStaticGroupMeshCount:
				(input.frameMetrics?.visibleDrawCountsByCategory["appearance-preview-staged"] ??
					0) + (input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			staticRenderBatchCount: input.worldStore?.appearancePreviewDrawUnitCount ?? 0,
			staticBvhCandidateBatchCount:
				(input.frameMetrics?.candidateCountsByCategory["appearance-preview-staged"] ?? 0) +
				(input.frameMetrics?.candidateCountsByCategory.static ?? 0),
			staticBvhRepresentedInstanceKeyCount:
				(input.frameMetrics?.representedItemKeyCountsByCategory[
					"appearance-preview-staged"
				] ?? 0) +
				(input.frameMetrics?.representedItemKeyCountsByCategory.static ?? 0),
			staticBvhVisibleInstanceKeyCount:
				(input.frameMetrics?.visibleDrawCountsByCategory["appearance-preview-staged"] ??
					0) + (input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			staticBvhFallbackIncludedBatchCount:
				(input.frameMetrics?.fallbackCountsByCategory["appearance-preview-staged"] ?? 0) +
				(input.frameMetrics?.fallbackCountsByCategory.static ?? 0),
			terrainRenderBatchCount: input.worldStore?.terrainTileCount ?? 0,
			terrainBvhCandidateBatchCount:
				input.frameMetrics?.candidateCountsByCategory.terrain ?? 0,
			structuredInteriorRenderBatchCount:
				input.submitMetrics.structuredInteriorResourceSubmittedCount,
			structuredInteriorBvhCandidateBatchCount:
				input.frameMetrics?.candidateCountsByCategory["structured-interior"] ??
				0,
			debugOverlayRenderBatchCount:
				input.frameMetrics?.candidateCountsByCategory["debug-overlay"] ?? 0,
			debugOverlayBvhCandidateBatchCount:
				input.frameMetrics?.visibleDrawCountsByCategory["debug-overlay"] ?? 0,
			portalMaskRenderBatchCount:
				input.frameMetrics?.candidateCountsByCategory["portal-mask"] ?? 0,
			portalMaskBvhCandidateBatchCount:
				input.submitMetrics.portalMaskDrawUnitCount,
			nonStaticBvhFallbackIncludedBatchCount:
				(input.frameMetrics?.fallbackCountsByCategory.terrain ?? 0) +
				(input.frameMetrics?.fallbackCountsByCategory["structured-interior"] ??
					0) +
				(input.frameMetrics?.fallbackCountsByCategory["portal-mask"] ?? 0) +
				(input.frameMetrics?.fallbackCountsByCategory["debug-overlay"] ?? 0),
			portalCompositeVisibleItemKeyCount: 0,
			portalCompositeStaticCandidateBatchCount: 0,
			portalCompositeTerrainCandidateBatchCount: 0,
			portalCompositeInteriorCandidateBatchCount: 0,
			portalCompositeFallbackIncludedBatchCount: 0,
			sceneDomainTargetWidth: input.sceneDomainTargetWidth,
			sceneDomainTargetHeight: input.sceneDomainTargetHeight,
			sceneDomainFramebufferFailureCount:
				input.sceneDomainFramebufferFailureCount,
			sceneDomainFramebufferFailureSamples: [
				...input.sceneDomainFramebufferFailureSamples,
			],
			sceneDomainBaseCopyPassCount: input.sceneDomainBaseCopyPassCount,
			sceneDomainExteriorDrawCallCount: input.sceneDomainExteriorDrawCallCount,
			sceneDomainInteriorDrawCallCount: input.sceneDomainInteriorDrawCallCount,
			sceneDomainExteriorDrawUnitCount:
				input.submitMetrics.exteriorDomainDrawUnitCount,
			sceneDomainInteriorDrawUnitCount:
				input.submitMetrics.interiorDomainDrawUnitCount,
			portalCompositeRectCount: input.portalCompositeRectCount,
			portalCompositeEstimatedPixelArea:
				input.portalCompositeEstimatedPixelArea,
			portalCompositeMaxDepth: input.portalCompositeMaxDepth,
			structuredInteriorMeshCount:
				input.worldStore?.structuredInteriorResourceCount ?? 0,
			visibleStructuredInteriorMeshCount:
				input.submitMetrics.structuredInteriorResourceSubmittedCount,
			terrainBvhVisibleItemCount:
				input.frameMetrics?.visibleDrawCountsByCategory.terrain ?? 0,
			terrainBvhTotalItemCount:
				input.frameMetrics?.candidateCountsByCategory.terrain ?? 0,
			outdoorStaticBvhVisibleItemCount:
				input.frameMetrics?.visibleDrawCountsByCategory["appearance-preview-staged"] ?? 0,
			outdoorStaticBvhTotalItemCount:
				input.frameMetrics?.candidateCountsByCategory["appearance-preview-staged"] ?? 0,
			envCellLocalBvhVisibleItemCount:
				input.frameMetrics?.visibleItemKeyCount ?? 0,
			envCellLocalBvhTotalItemCount:
				input.frameMetrics?.representedItemKeyCount ?? 0,
			visibleStaticInstanceKeyCount: input.worldStore?.appearancePreviewInstanceCount ?? 0,
			visiblePortalKeyCount: 0,
			envCellBvhConsideredCount: 0,
			fallbackReasonCount:
				(input.initializationError ? 1 : 0) +
				(input.worldStore?.materialFallbackReasonCount ?? 0) +
				(input.frameMetrics?.fallbackReasonCount ?? 0),
			fallbackReasonSamples: [
				...(input.initializationError
					? [`webgl2 initialization failed: ${input.initializationError}`]
					: []),
				...(input.worldStore?.materialFallbackReasonSamples ?? []),
				...(input.frameMetrics?.fallbackReasonSamples ?? []),
			],
			queryTimeMs: 0,
			debugOverlayObjectCount: 0,
			visibleDebugOverlayObjectCount: 0,
			materialCount: input.worldStore?.materialCount ?? 0,
			materialProgramKeyCount: input.worldStore?.materialCount ?? 0,
			transparentMaterialCount: 0,
			textureFilteringMode: input.textureFilteringMode,
			detailTexturesEnabled: input.detailTexturesEnabled,
			textureSamplingPolicyCounts:
				input.worldStore?.textureSamplingPolicyCounts ?? {},
			texturePageBindingCount: input.worldStore?.texturePageBindingCount ?? 0,
			texturePageUsageBucketCounts:
				input.worldStore?.texturePageUsageBucketCounts ?? {},
			texturePageSampleClassCounts:
				input.worldStore?.texturePageSampleClassCounts ?? {},
			texturePageReadyMaterialCount:
				input.worldStore?.texturePageReadyMaterialCount ?? 0,
			atlasCandidateEntryCount: input.worldStore?.atlasCandidateEntryCount ?? 0,
			atlasCandidateMaterialSlotCount:
				input.worldStore?.atlasCandidateMaterialSlotCount ?? 0,
			atlasCompatibleDrawUnitCount:
				input.worldStore?.atlasCompatibleDrawUnitCount ?? 0,
			atlasPlacedRgbaDrawUnitCount:
				input.worldStore?.atlasPlacedRgbaDrawUnitCount ?? 0,
			detailAtlasReadyDrawUnitCount:
				input.worldStore?.detailAtlasReadyDrawUnitCount ?? 0,
			atlasFailureReasonCount: input.worldStore?.atlasFailureReasonCount ?? 0,
			atlasFailureSamples: [...(input.worldStore?.atlasFailureSamples ?? [])],
			compactionCandidateDrawUnitCount:
				input.worldStore?.compactionCandidateDrawUnitCount ?? 0,
			compactionBypassReasonCount:
				input.worldStore?.compactionBypassReasonCount ?? 0,
			compactionBypassSamples: [
				...(input.worldStore?.compactionBypassSamples ?? []),
			],
			compactionBypassBlockerSamples: [
				...(input.worldStore?.compactionBypassBlockerSamples ?? []),
			],
			compactionBypassDetailSamples: [
				...(input.worldStore?.compactionBypassDetailSamples ?? []),
			],
			compactionCoverageDrawUnitCounts:
				input.worldStore?.compactionCoverageDrawUnitCounts ?? {},
			compactionCoverageMaterialBlockerCounts:
				input.worldStore?.compactionCoverageMaterialBlockerCounts ?? {},
			compactionCoverageGeometryBlockerCounts:
				input.worldStore?.compactionCoverageGeometryBlockerCounts ?? {},
			compactionCoverageMaterialFamilyCounts:
				input.worldStore?.compactionCoverageMaterialFamilyCounts ?? {},
			compactionCoverageMaterialAlphaPolicyCounts:
				input.worldStore?.compactionCoverageMaterialAlphaPolicyCounts ?? {},
			compactionCoverageMaterialFamilyAlphaPolicyCounts:
				input.worldStore?.compactionCoverageMaterialFamilyAlphaPolicyCounts ??
				{},
			compactionCoverageRetainedDirectMaterialFamilyCounts:
				input.worldStore
					?.compactionCoverageRetainedDirectMaterialFamilyCounts ?? {},
			compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts:
				input.worldStore
					?.compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts ??
				{},
			compactionCoverageVisibleRetainedDirectMaterialFamilyCounts:
				input.submitMetrics
					.visibleRetainedDirectDrawUnitCountsByCompactionFamily,
			textureAtlasGenerationTextureCount:
				input.worldStore?.textureAtlasGenerationTextureCount ?? 0,
			detailTextureAtlasGenerationTextureCount:
				input.worldStore?.detailTextureAtlasGenerationTextureCount ?? 0,
			rgbaTexturePageFamilyShaderDrawCallCount:
				input.submitMetrics.rgbaTexturePageFamilyShaderDrawCallCount,
			rgbaTexturePageFamilySubmittedBatchCount:
				input.submitMetrics.rgbaTexturePageFamilySubmittedBatchCount,
			rgbaTexturePageFamilySubmittedDrawSliceCount:
				input.submitMetrics.rgbaTexturePageFamilySubmittedDrawSliceCount,
			rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount:
				input.submitMetrics
					.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount,
			rgbaTexturePageFamilySubmittedTriangleCount:
				input.submitMetrics.rgbaTexturePageFamilySubmittedTriangleCount,
			rgbaTexturePageFamilyReplacedDrawUnitCount:
				input.submitMetrics.rgbaTexturePageFamilyReplacedDrawUnitCount,
			rgbaTexturePageFamilyReplacedDrawUnitTriangleCount:
				input.submitMetrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount,
			rgbaTexturePageFamilyConservativeOverdrawTriangleCount:
				input.submitMetrics
					.rgbaTexturePageFamilyConservativeOverdrawTriangleCount,
			rgbaTexturePageFamilyConservativeOverdrawRatio:
				input.submitMetrics.rgbaTexturePageFamilyConservativeOverdrawRatio,
			rgbaTexturePageFamilyRetainedDirectDrawUnitCount:
				input.submitMetrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount,
			rgbaTexturePageFamilyOriginalDrawCallEstimateCount:
				input.submitMetrics.rgbaTexturePageFamilyOriginalDrawCallEstimateCount,
			rgbaTexturePageFamilySubmittedDrawCallEstimateCount:
				input.submitMetrics.rgbaTexturePageFamilySubmittedDrawCallEstimateCount,
			rgbaTexturePageFamilyDrawCallSavingsCount:
				input.submitMetrics.rgbaTexturePageFamilyDrawCallSavingsCount,
			rgbaTexturePageFamilyNoVisibleRouteCount:
				input.submitMetrics.rgbaTexturePageFamilyNoVisibleRouteCount,
			rgbaTexturePageFamilyNoVisibleExteriorRouteCount:
				input.submitMetrics.rgbaTexturePageFamilyNoVisibleExteriorRouteCount,
			rgbaTexturePageFamilyNoVisibleInteriorRouteCount:
				input.submitMetrics.rgbaTexturePageFamilyNoVisibleInteriorRouteCount,
			rgbaTexturePageFamilyNoVisibleOtherRouteCount:
				input.submitMetrics.rgbaTexturePageFamilyNoVisibleOtherRouteCount,
			rgbaTexturePageFamilyFallbackSamples: [
				...input.submitMetrics.rgbaTexturePageFamilyFallbackSamples,
			],
			indexedPalettedFamilyShaderDrawCallCount:
				input.submitMetrics.indexedPalettedFamilyShaderDrawCallCount,
			indexedPalettedFamilySubmittedBatchCount:
				input.submitMetrics.indexedPalettedFamilySubmittedBatchCount,
			indexedPalettedFamilySubmittedDrawSliceCount:
				input.submitMetrics.indexedPalettedFamilySubmittedDrawSliceCount,
			indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount:
				input.submitMetrics
					.indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount,
			indexedPalettedFamilySubmittedTriangleCount:
				input.submitMetrics.indexedPalettedFamilySubmittedTriangleCount,
			indexedPalettedFamilyReplacedDrawUnitCount:
				input.submitMetrics.indexedPalettedFamilyReplacedDrawUnitCount,
			indexedPalettedFamilyReplacedDrawUnitTriangleCount:
				input.submitMetrics.indexedPalettedFamilyReplacedDrawUnitTriangleCount,
			indexedPalettedFamilyRetainedDirectDrawUnitCount:
				input.submitMetrics.indexedPalettedFamilyRetainedDirectDrawUnitCount,
			indexedPalettedFamilyOriginalDrawCallEstimateCount:
				input.submitMetrics.indexedPalettedFamilyOriginalDrawCallEstimateCount,
			indexedPalettedFamilySubmittedDrawCallEstimateCount:
				input.submitMetrics.indexedPalettedFamilySubmittedDrawCallEstimateCount,
			indexedPalettedFamilyDrawCallSavingsCount:
				input.submitMetrics.indexedPalettedFamilyDrawCallSavingsCount,
			indexedPalettedFamilyNoVisibleRouteCount:
				input.submitMetrics.indexedPalettedFamilyNoVisibleRouteCount,
			retainedDirectOpaqueDrawUnitCount:
				input.submitMetrics.retainedDirectOpaqueDrawUnitCount,
			retainedDirectBlendedDrawUnitCount:
				input.submitMetrics.retainedDirectBlendedDrawUnitCount,
			directTexturePageDrawCount:
				input.submitMetrics.directTexturePageDrawCount,
			directSingleEntryTexturePageDrawCount:
				input.submitMetrics.directSingleEntryTexturePageDrawCount,
			directPackedTexturePageDrawCount:
				input.submitMetrics.directPackedTexturePageDrawCount,
			directPackedTexturePageEstimatedBindAvoidedCount:
				input.submitMetrics.directPackedTexturePageEstimatedBindAvoidedCount,
			directPackedTexturePageTextureCount:
				input.submitMetrics.directPackedTexturePageTextureCount,
			directTexturePageFallbackSamples: [
				...input.submitMetrics.directTexturePageFallbackSamples,
			],
			textureVelocityPartCount: 0,
			textureVelocityRenderGroupCount: 0,
			textureVelocityMaterialCount: 0,
			textureVelocitySignatureCount: 0,
			textureVelocitySignatureSamples: [],
			textureResourceCount: input.worldStore?.textureCount ?? 0,
			textureAtlasWorkerActiveSchedulerCount:
				input.worldStore?.textureAtlasWorkerMetrics.activeSchedulerCount ?? 0,
			textureAtlasWorkerSubmittedJobCount:
				input.worldStore?.textureAtlasWorkerMetrics.submittedJobCount ?? 0,
			textureAtlasWorkerDedupedDesiredJobCount:
				input.worldStore?.textureAtlasWorkerMetrics.dedupedDesiredJobCount ?? 0,
			textureAtlasWorkerCoalescedDesiredJobCount:
				input.worldStore?.textureAtlasWorkerMetrics.coalescedDesiredJobCount ??
				0,
			textureAtlasWorkerStaleResultCount:
				input.worldStore?.textureAtlasWorkerMetrics.staleResultCount ?? 0,
			textureAtlasWorkerReadyResultCount:
				input.worldStore?.textureAtlasWorkerMetrics.readyResultCount ?? 0,
			textureAtlasWorkerCommittedResultCount:
				input.worldStore?.textureAtlasWorkerMetrics.committedResultCount ?? 0,
			textureAtlasWorkerErrorCount:
				input.worldStore?.textureAtlasWorkerMetrics.errorCount ?? 0,
			indexedTextureResourceCount: input.worldStore?.indexedTextureCount ?? 0,
			paletteResourceCount: input.worldStore?.paletteTextureCount ?? 0,
			indexedMaterialDescriptorDrawUnitCount:
				input.worldStore?.indexedMaterialDescriptorDrawUnitCount ?? 0,
			indexedMaterialDescriptorCompactionCandidateCount:
				input.worldStore?.indexedMaterialDescriptorCompactionCandidateCount ??
				0,
			standaloneIndexedMaterialResourceDrawUnitCount:
				input.worldStore?.standaloneIndexedMaterialResourceDrawUnitCount ?? 0,
			compactedIndexedMaterialStandaloneResourceDrawUnitCount:
				input.worldStore
					?.compactedIndexedMaterialStandaloneResourceDrawUnitCount ?? 0,
			indexedResourceAtlasCandidateDrawUnitCount:
				input.worldStore?.indexedResourceAtlasCandidateDrawUnitCount ?? 0,
			indexedResourceAtlasIndexTextureCount:
				input.worldStore?.indexedResourceAtlasIndexTextureCount ?? 0,
			indexedResourceAtlasPaletteTextureCount:
				input.worldStore?.indexedResourceAtlasPaletteTextureCount ?? 0,
			indexedResourceAtlasFailureReasonCount:
				input.worldStore?.indexedResourceAtlasFailureReasonCount ?? 0,
			indexedResourceAtlasFailureSamples: [
				...(input.worldStore?.indexedResourceAtlasFailureSamples ?? []),
			],
			indexedResourceAtlasWorkerActiveSchedulerCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics
					.activeSchedulerCount ?? 0,
			indexedResourceAtlasWorkerSubmittedJobCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics.submittedJobCount ??
				0,
			indexedResourceAtlasWorkerDedupedDesiredJobCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics
					.dedupedDesiredJobCount ?? 0,
			indexedResourceAtlasWorkerCoalescedDesiredJobCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics
					.coalescedDesiredJobCount ?? 0,
			indexedResourceAtlasWorkerStaleResultCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics.staleResultCount ??
				0,
			indexedResourceAtlasWorkerReadyResultCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics.readyResultCount ??
				0,
			indexedResourceAtlasWorkerCommittedResultCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics
					.committedResultCount ?? 0,
			indexedResourceAtlasWorkerErrorCount:
				input.worldStore?.indexedResourceAtlasWorkerMetrics.errorCount ?? 0,
			staticGeometryGroupCount: input.worldStore?.appearancePreviewDrawUnitCount ?? 0,
			staticVisibleGeometryGroupCount:
				(input.frameMetrics?.visibleDrawCountsByCategory["appearance-preview-staged"] ??
					0) + (input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			structuredInteriorGeometryGroupCount:
				input.worldStore?.structuredInteriorResourceCount ?? 0,
			materialTypeCounts: input.worldStore
				? {
						"webgl2-flat-resource":
							input.worldStore.drawUnits.length -
							input.worldStore.directTextureDrawUnitCount,
						"webgl2-direct-texture":
							input.worldStore.directTextureDrawUnitCount,
						"webgl2-atlas-eligible":
							input.worldStore.texturePageReadyMaterialCount,
						"webgl2-atlas-compatible-draw-units":
							input.worldStore.atlasCompatibleDrawUnitCount,
						"webgl2-atlas-placed-rgba-draw-units":
							input.worldStore.atlasPlacedRgbaDrawUnitCount,
						"webgl2-detail-atlas-ready-draw-units":
							input.worldStore.detailAtlasReadyDrawUnitCount,
						"webgl2-atlas-failures": input.worldStore.atlasFailureReasonCount,
						"webgl2-compacted-candidates":
							input.worldStore.compactionCandidateDrawUnitCount,
						"webgl2-compacted-bypasses":
							input.worldStore.compactionBypassReasonCount,
						...prefixCounts(
							"webgl2-compacted-coverage-",
							input.worldStore.compactionCoverageDrawUnitCounts,
						),
						...prefixCounts(
							"webgl2-compacted-material-blocker-",
							input.worldStore.compactionCoverageMaterialBlockerCounts,
						),
						...prefixCounts(
							"webgl2-compacted-geometry-blocker-",
							input.worldStore.compactionCoverageGeometryBlockerCounts,
						),
						...prefixCounts(
							"webgl2-compacted-material-family-",
							input.worldStore.compactionCoverageMaterialFamilyCounts,
						),
						...prefixCounts(
							"webgl2-compacted-alpha-policy-",
							input.worldStore.compactionCoverageMaterialAlphaPolicyCounts,
						),
						...prefixCounts(
							"webgl2-compacted-family-alpha-policy-",
							input.worldStore
								.compactionCoverageMaterialFamilyAlphaPolicyCounts,
						),
						...prefixCounts(
							"webgl2-compacted-retained-family-",
							input.worldStore
								.compactionCoverageRetainedDirectMaterialFamilyCounts,
						),
						...prefixCounts(
							"webgl2-compacted-retained-family-alpha-policy-",
							input.worldStore
								.compactionCoverageRetainedDirectMaterialFamilyAlphaPolicyCounts,
						),
						...prefixCounts(
							"webgl2-compacted-visible-retained-family-",
							input.submitMetrics
								.visibleRetainedDirectDrawUnitCountsByCompactionFamily,
						),
						"webgl2-texture-atlas-generation-textures":
							input.worldStore.textureAtlasGenerationTextureCount,
						"webgl2-detail-texture-atlas-generation-textures":
							input.worldStore.detailTextureAtlasGenerationTextureCount,
						"webgl2-texture-atlas-worker-active-schedulers":
							input.worldStore.textureAtlasWorkerMetrics.activeSchedulerCount,
						"webgl2-texture-atlas-worker-submitted-jobs":
							input.worldStore.textureAtlasWorkerMetrics.submittedJobCount,
						"webgl2-texture-atlas-worker-stale-results":
							input.worldStore.textureAtlasWorkerMetrics.staleResultCount,
						"webgl2-texture-atlas-worker-ready-results":
							input.worldStore.textureAtlasWorkerMetrics.readyResultCount,
						"webgl2-texture-atlas-worker-committed-results":
							input.worldStore.textureAtlasWorkerMetrics.committedResultCount,
						"webgl2-texture-atlas-worker-errors":
							input.worldStore.textureAtlasWorkerMetrics.errorCount,
						"webgl2-rgba-family-shader-draws":
							input.submitMetrics.rgbaTexturePageFamilyShaderDrawCallCount,
						"webgl2-rgba-family-submitted-batches":
							input.submitMetrics.rgbaTexturePageFamilySubmittedBatchCount,
						"webgl2-rgba-family-submitted-slices":
							input.submitMetrics.rgbaTexturePageFamilySubmittedDrawSliceCount,
						"webgl2-rgba-family-submitted-slice-draw-units":
							input.submitMetrics
								.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount,
						"webgl2-rgba-family-submitted-triangles":
							input.submitMetrics.rgbaTexturePageFamilySubmittedTriangleCount,
						"webgl2-rgba-family-replaced-draw-units":
							input.submitMetrics.rgbaTexturePageFamilyReplacedDrawUnitCount,
						"webgl2-rgba-family-replaced-triangles":
							input.submitMetrics
								.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount,
						"webgl2-rgba-family-original-draw-call-estimate":
							input.submitMetrics
								.rgbaTexturePageFamilyOriginalDrawCallEstimateCount,
						"webgl2-rgba-family-submitted-draw-call-estimate":
							input.submitMetrics
								.rgbaTexturePageFamilySubmittedDrawCallEstimateCount,
						"webgl2-rgba-family-conservative-overdraw-triangles":
							input.submitMetrics
								.rgbaTexturePageFamilyConservativeOverdrawTriangleCount,
						"webgl2-rgba-family-draw-call-savings":
							input.submitMetrics.rgbaTexturePageFamilyDrawCallSavingsCount,
						"webgl2-rgba-family-no-visible-routes":
							input.submitMetrics.rgbaTexturePageFamilyNoVisibleRouteCount,
						"webgl2-indexed-family-shader-draws":
							input.submitMetrics.indexedPalettedFamilyShaderDrawCallCount,
						"webgl2-indexed-family-submitted-batches":
							input.submitMetrics.indexedPalettedFamilySubmittedBatchCount,
						"webgl2-indexed-family-submitted-slices":
							input.submitMetrics.indexedPalettedFamilySubmittedDrawSliceCount,
						"webgl2-indexed-family-submitted-slice-draw-units":
							input.submitMetrics
								.indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount,
						"webgl2-indexed-family-submitted-triangles":
							input.submitMetrics.indexedPalettedFamilySubmittedTriangleCount,
						"webgl2-indexed-family-replaced-draw-units":
							input.submitMetrics.indexedPalettedFamilyReplacedDrawUnitCount,
						"webgl2-indexed-family-replaced-triangles":
							input.submitMetrics
								.indexedPalettedFamilyReplacedDrawUnitTriangleCount,
						"webgl2-indexed-family-original-draw-call-estimate":
							input.submitMetrics
								.indexedPalettedFamilyOriginalDrawCallEstimateCount,
						"webgl2-indexed-family-submitted-draw-call-estimate":
							input.submitMetrics
								.indexedPalettedFamilySubmittedDrawCallEstimateCount,
						"webgl2-indexed-family-draw-call-savings":
							input.submitMetrics.indexedPalettedFamilyDrawCallSavingsCount,
						"webgl2-indexed-family-no-visible-routes":
							input.submitMetrics.indexedPalettedFamilyNoVisibleRouteCount,
						"webgl2-indexed-descriptor-draw-units":
							input.worldStore.indexedMaterialDescriptorDrawUnitCount,
						"webgl2-indexed-descriptor-compaction-candidates":
							input.worldStore
								.indexedMaterialDescriptorCompactionCandidateCount,
						"webgl2-standalone-indexed-resource-draw-units":
							input.worldStore.standaloneIndexedMaterialResourceDrawUnitCount,
						"webgl2-compacted-indexed-standalone-resource-draw-units":
							input.worldStore
								.compactedIndexedMaterialStandaloneResourceDrawUnitCount,
						"webgl2-indexed-resource-atlas-candidate-draw-units":
							input.worldStore.indexedResourceAtlasCandidateDrawUnitCount,
						"webgl2-indexed-resource-atlas-index-textures":
							input.worldStore.indexedResourceAtlasIndexTextureCount,
						"webgl2-indexed-resource-atlas-palette-textures":
							input.worldStore.indexedResourceAtlasPaletteTextureCount,
						"webgl2-indexed-resource-atlas-failures":
							input.worldStore.indexedResourceAtlasFailureReasonCount,
						"webgl2-indexed-atlas-worker-active-schedulers":
							input.worldStore.indexedResourceAtlasWorkerMetrics
								.activeSchedulerCount,
						"webgl2-indexed-atlas-worker-submitted-jobs":
							input.worldStore.indexedResourceAtlasWorkerMetrics
								.submittedJobCount,
						"webgl2-indexed-atlas-worker-stale-results":
							input.worldStore.indexedResourceAtlasWorkerMetrics
								.staleResultCount,
						"webgl2-indexed-atlas-worker-ready-results":
							input.worldStore.indexedResourceAtlasWorkerMetrics
								.readyResultCount,
						"webgl2-indexed-atlas-worker-committed-results":
							input.worldStore.indexedResourceAtlasWorkerMetrics
								.committedResultCount,
						"webgl2-indexed-atlas-worker-errors":
							input.worldStore.indexedResourceAtlasWorkerMetrics.errorCount,
						"webgl2-retained-direct-opaque-draw-units":
							input.submitMetrics.retainedDirectOpaqueDrawUnitCount,
						"webgl2-retained-direct-blended-draw-units":
							input.submitMetrics.retainedDirectBlendedDrawUnitCount,
						"webgl2-direct-packed-texture-page-draws":
							input.submitMetrics.directPackedTexturePageDrawCount,
						"webgl2-direct-single-entry-texture-page-draws":
							input.submitMetrics.directSingleEntryTexturePageDrawCount,
						"webgl2-direct-packed-texture-page-estimated-texture-binds-avoided":
							input.submitMetrics
								.directPackedTexturePageEstimatedBindAvoidedCount,
						"webgl2-direct-packed-texture-page-textures":
							input.submitMetrics.directPackedTexturePageTextureCount,
						"webgl2-detail-overlay": input.worldStore.detailTextureCount,
						...prefixCounts(
							"webgl2-visible-",
							input.submitMetrics.visibleDrawUnitCountsByMaterialKind,
						),
						"webgl2-program-switches": input.submitMetrics.programSwitchCount,
						"webgl2-vao-binds": input.submitMetrics.vertexArrayBindCount,
						"webgl2-uniform-uploads": input.submitMetrics.uniformUploadCount,
						"webgl2-state-changes": input.submitMetrics.stateChangeCount,
					}
				: {},
			materialProgramKeySamples: [],
			preparedTextureUploadCount:
				input.worldStore?.preparedTextureUploadCount ?? 0,
			preparedTextureGeneratedByteLength:
				input.worldStore?.preparedTextureGeneratedByteLength ?? 0,
			compressedSingleLevelFallbackUploadCount: 0,
			renderCalls:
				input.worldStore && input.worldStore.drawUnits.length > 0
					? input.submitMetrics.drawCallCount
					: input.lastFrameDrawCount,
			renderTriangles:
				input.worldStore && input.worldStore.drawUnits.length > 0
					? input.submitMetrics.triangleCount
					: input.lastFrameDrawCount,
			renderLines: 0,
			renderPoints: 0,
		},
		geometry: {
			terrainTileCount: input.terrainScene.tiles.length,
			terrainVertexCount: input.terrainScene.tiles.reduce(
				(total, tile) => total + tile.mesh.vertices.length,
				0,
			),
			terrainTriangleCount: input.terrainScene.tiles.reduce(
				(total, tile) => total + tile.mesh.triangles.length,
				0,
			),
			staticRenderablePartCount: input.staticRenderableScene.parts.length,
			staticRenderableInstancedGroupCount:
				input.staticRenderableScene.partsByRenderGroupKey.size,
			structuredInteriorCellCount: input.structuredInteriorScene.cells.length,
			structuredInteriorVertexCount: input.structuredInteriorScene.cells.reduce(
				(total, cell) => total + cell.renderGeometry.vertexCount,
				0,
			),
			structuredInteriorTriangleCount:
				input.structuredInteriorScene.cells.reduce(
					(total, cell) => total + cell.renderGeometry.triangleCount,
					0,
				),
		},
	};
}

function prefixCounts(
	prefix: string,
	counts: Readonly<Record<string, number>>,
): Record<string, number> {
	return Object.fromEntries(
		Object.entries(counts).map(([key, value]) => [`${prefix}${key}`, value]),
	);
}
