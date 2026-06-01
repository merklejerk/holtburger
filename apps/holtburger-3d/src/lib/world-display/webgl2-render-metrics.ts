import type { SceneBoundsFrame, SceneCameraFrame } from "./camera";
import type { StagedWorldFrameMetrics } from "./staged-world-frame";
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
	frameMetrics: StagedWorldFrameMetrics | null;
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
			terrainMeshCount: input.worldStore?.terrainDrawUnitCount ?? 0,
			visibleTerrainMeshCount:
				input.frameMetrics?.visibleDrawCountsByCategory.terrain ?? 0,
			staticGroupMeshCount: input.worldStore?.staticDrawUnitCount ?? 0,
			visibleStaticGroupMeshCount:
				(input.frameMetrics?.visibleDrawCountsByCategory["static-staged"] ??
					0) + (input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			staticRenderBatchCount: input.worldStore?.staticDrawUnitCount ?? 0,
			staticBvhCandidateBatchCount:
				(input.frameMetrics?.candidateCountsByCategory["static-staged"] ?? 0) +
				(input.frameMetrics?.candidateCountsByCategory.static ?? 0),
			staticBvhRepresentedInstanceKeyCount:
				(input.frameMetrics?.representedItemKeyCountsByCategory[
					"static-staged"
				] ?? 0) +
				(input.frameMetrics?.representedItemKeyCountsByCategory.static ?? 0),
			staticBvhVisibleInstanceKeyCount:
				(input.frameMetrics?.visibleDrawCountsByCategory["static-staged"] ??
					0) + (input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			staticBvhFallbackIncludedBatchCount:
				(input.frameMetrics?.fallbackCountsByCategory["static-staged"] ?? 0) +
				(input.frameMetrics?.fallbackCountsByCategory.static ?? 0),
			terrainRenderBatchCount: input.worldStore?.terrainDrawUnitCount ?? 0,
			terrainBvhCandidateBatchCount:
				input.frameMetrics?.candidateCountsByCategory.terrain ?? 0,
			structuredInteriorRenderBatchCount:
				input.worldStore?.structuredInteriorDrawUnitCount ?? 0,
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
				input.worldStore?.structuredInteriorDrawUnitCount ?? 0,
			visibleStructuredInteriorMeshCount:
				input.frameMetrics?.visibleDrawCountsByCategory[
					"structured-interior"
				] ?? 0,
			terrainBvhVisibleItemCount:
				input.frameMetrics?.visibleDrawCountsByCategory.terrain ?? 0,
			terrainBvhTotalItemCount:
				input.frameMetrics?.candidateCountsByCategory.terrain ?? 0,
			outdoorStaticBvhVisibleItemCount:
				input.frameMetrics?.visibleDrawCountsByCategory["static-staged"] ?? 0,
			outdoorStaticBvhTotalItemCount:
				input.frameMetrics?.candidateCountsByCategory["static-staged"] ?? 0,
			envCellLocalBvhVisibleItemCount:
				input.frameMetrics?.visibleItemKeyCount ?? 0,
			envCellLocalBvhTotalItemCount:
				input.frameMetrics?.representedItemKeyCount ?? 0,
			visibleStaticInstanceKeyCount: input.worldStore?.staticInstanceCount ?? 0,
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
			atlasEligibleMaterialCount:
				input.worldStore?.atlasEligibleMaterialCount ?? 0,
			atlasCandidateEntryCount: input.worldStore?.atlasCandidateEntryCount ?? 0,
			atlasCandidateMaterialSlotCount:
				input.worldStore?.atlasCandidateMaterialSlotCount ?? 0,
			bakedCandidateDrawUnitCount:
				input.worldStore?.bakedCandidateDrawUnitCount ?? 0,
			bakedBypassReasonCount: input.worldStore?.bakedBypassReasonCount ?? 0,
			bakedBypassSamples: [...(input.worldStore?.bakedBypassSamples ?? [])],
			bakedCoverageDrawUnitCounts:
				input.worldStore?.bakedCoverageDrawUnitCounts ?? {},
			bakedCoverageMaterialBlockerCounts:
				input.worldStore?.bakedCoverageMaterialBlockerCounts ?? {},
			bakedCoverageGeometryBlockerCounts:
				input.worldStore?.bakedCoverageGeometryBlockerCounts ?? {},
			bakedCoverageMaterialFamilyCounts:
				input.worldStore?.bakedCoverageMaterialFamilyCounts ?? {},
			bakedCoverageRetainedDirectMaterialFamilyCounts:
				input.worldStore?.bakedCoverageRetainedDirectMaterialFamilyCounts ?? {},
			bakedCoverageVisibleRetainedDirectMaterialFamilyCounts:
				input.submitMetrics
					.visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily,
			textureAtlasGenerationTextureCount:
				input.worldStore?.textureAtlasGenerationTextureCount ?? 0,
			detailTextureAtlasGenerationTextureCount:
				input.worldStore?.detailTextureAtlasGenerationTextureCount ?? 0,
			bakedGeometryBatchCount: input.worldStore?.bakedGeometryBatchCount ?? 0,
			bakedGeometryDrawUnitCount:
				input.worldStore?.bakedGeometryDrawUnitCount ?? 0,
			bakedGeometryTriangleCount:
				input.worldStore?.bakedGeometryTriangleCount ?? 0,
			bakedGeometryVertexByteLength:
				input.worldStore?.bakedGeometryVertexByteLength ?? 0,
			bakedGeometryIndexByteLength:
				input.worldStore?.bakedGeometryIndexByteLength ?? 0,
			bakedGeometryTotalByteLength:
				input.worldStore?.bakedGeometryTotalByteLength ?? 0,
			bakedGeometryDrawSliceCount:
				input.worldStore?.bakedGeometryDrawSliceCount ?? 0,
			bakedGeometryBatchOriginCount:
				input.worldStore?.bakedGeometryBatchOriginCount ?? 0,
			bakedGeometryTransformTableEntryCount:
				input.worldStore?.bakedGeometryTransformTableEntryCount ?? 0,
			bakedResourceFallbackSamples: [
				...(input.worldStore?.bakedResourceFallbackSamples ?? []),
			],
			bakedShaderDrawCallCount: input.submitMetrics.bakedShaderDrawCallCount,
			bakedSubmittedBatchCount: input.submitMetrics.bakedSubmittedBatchCount,
			bakedSubmittedDrawSliceCount:
				input.submitMetrics.bakedSubmittedDrawSliceCount,
			bakedSubmittedSliceRepresentedDrawUnitCount:
				input.submitMetrics.bakedSubmittedSliceRepresentedDrawUnitCount,
			bakedSubmittedTriangleCount:
				input.submitMetrics.bakedSubmittedTriangleCount,
			bakedReplacedDrawUnitCount:
				input.submitMetrics.bakedReplacedDrawUnitCount,
			bakedReplacedDrawUnitTriangleCount:
				input.submitMetrics.bakedReplacedDrawUnitTriangleCount,
			bakedConservativeOverdrawTriangleCount:
				input.submitMetrics.bakedConservativeOverdrawTriangleCount,
			bakedConservativeOverdrawRatio:
				input.submitMetrics.bakedConservativeOverdrawRatio,
			bakedRetainedDirectDrawUnitCount:
				input.submitMetrics.bakedRetainedDirectDrawUnitCount,
			bakedOriginalDrawCallEstimateCount:
				input.submitMetrics.bakedOriginalDrawCallEstimateCount,
			bakedSubmittedDrawCallEstimateCount:
				input.submitMetrics.bakedSubmittedDrawCallEstimateCount,
			bakedDrawCallSavingsCount: input.submitMetrics.bakedDrawCallSavingsCount,
			bakedSubmitNoVisibleRouteCount:
				input.submitMetrics.bakedSubmitNoVisibleRouteCount,
			bakedSubmitNoVisibleExteriorRouteCount:
				input.submitMetrics.bakedSubmitNoVisibleExteriorRouteCount,
			bakedSubmitNoVisibleInteriorRouteCount:
				input.submitMetrics.bakedSubmitNoVisibleInteriorRouteCount,
			bakedSubmitNoVisibleOtherRouteCount:
				input.submitMetrics.bakedSubmitNoVisibleOtherRouteCount,
			bakedSubmitFallbackSamples: [
				...input.submitMetrics.bakedSubmitFallbackSamples,
			],
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
			stagedAtlasDrawCount: input.submitMetrics.stagedAtlasDrawCount,
			stagedAtlasStandaloneDirectDrawCount:
				input.submitMetrics.stagedAtlasStandaloneDirectDrawCount,
			stagedAtlasEstimatedTextureBindAvoidedCount:
				input.submitMetrics.stagedAtlasEstimatedTextureBindAvoidedCount,
			stagedAtlasSharedTextureAtlasTextureCount:
				input.submitMetrics.stagedAtlasSharedTextureAtlasTextureCount,
			stagedAtlasFallbackSamples: [
				...input.submitMetrics.stagedAtlasFallbackSamples,
			],
			textureVelocityPartCount: 0,
			textureVelocityRenderGroupCount: 0,
			textureVelocityMaterialCount: 0,
			textureVelocitySignatureCount: 0,
			textureVelocitySignatureSamples: [],
			textureResourceCount: input.worldStore?.textureCount ?? 0,
			indexedTextureResourceCount: input.worldStore?.indexedTextureCount ?? 0,
			paletteResourceCount: input.worldStore?.paletteTextureCount ?? 0,
			staticGeometryGroupCount: input.worldStore?.staticDrawUnitCount ?? 0,
			staticVisibleGeometryGroupCount:
				(input.frameMetrics?.visibleDrawCountsByCategory["static-staged"] ??
					0) + (input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			structuredInteriorGeometryGroupCount:
				input.worldStore?.structuredInteriorDrawUnitCount ?? 0,
			materialTypeCounts: input.worldStore
				? {
						"webgl2-flat-resource":
							input.worldStore.drawUnits.length -
							input.worldStore.directTextureDrawUnitCount,
						"webgl2-direct-texture":
							input.worldStore.directTextureDrawUnitCount,
						"webgl2-atlas-eligible":
							input.worldStore.atlasEligibleMaterialCount,
						"webgl2-baked-candidates":
							input.worldStore.bakedCandidateDrawUnitCount,
						"webgl2-baked-bypasses": input.worldStore.bakedBypassReasonCount,
						...prefixCounts(
							"webgl2-baked-coverage-",
							input.worldStore.bakedCoverageDrawUnitCounts,
						),
						...prefixCounts(
							"webgl2-baked-material-blocker-",
							input.worldStore.bakedCoverageMaterialBlockerCounts,
						),
						...prefixCounts(
							"webgl2-baked-geometry-blocker-",
							input.worldStore.bakedCoverageGeometryBlockerCounts,
						),
						...prefixCounts(
							"webgl2-baked-material-family-",
							input.worldStore.bakedCoverageMaterialFamilyCounts,
						),
						...prefixCounts(
							"webgl2-baked-retained-family-",
							input.worldStore
								.bakedCoverageRetainedDirectMaterialFamilyCounts,
						),
						...prefixCounts(
							"webgl2-baked-visible-retained-family-",
							input.submitMetrics
								.visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily,
						),
						"webgl2-texture-atlas-generation-textures":
							input.worldStore.textureAtlasGenerationTextureCount,
						"webgl2-detail-texture-atlas-generation-textures":
							input.worldStore.detailTextureAtlasGenerationTextureCount,
						"webgl2-baked-geometry-batches":
							input.worldStore.bakedGeometryBatchCount,
						"webgl2-baked-geometry-draw-units":
							input.worldStore.bakedGeometryDrawUnitCount,
						"webgl2-baked-geometry-draw-slices":
							input.worldStore.bakedGeometryDrawSliceCount,
						"webgl2-baked-geometry-batch-origins":
							input.worldStore.bakedGeometryBatchOriginCount,
						"webgl2-baked-geometry-transform-table-entries":
							input.worldStore.bakedGeometryTransformTableEntryCount,
						"webgl2-baked-shader-draws":
							input.submitMetrics.bakedShaderDrawCallCount,
						"webgl2-baked-submitted-batches":
							input.submitMetrics.bakedSubmittedBatchCount,
						"webgl2-baked-submitted-slices":
							input.submitMetrics.bakedSubmittedDrawSliceCount,
						"webgl2-baked-submitted-slice-draw-units":
							input.submitMetrics.bakedSubmittedSliceRepresentedDrawUnitCount,
						"webgl2-baked-submitted-triangles":
							input.submitMetrics.bakedSubmittedTriangleCount,
						"webgl2-baked-replaced-draw-units":
							input.submitMetrics.bakedReplacedDrawUnitCount,
						"webgl2-baked-replaced-triangles":
							input.submitMetrics.bakedReplacedDrawUnitTriangleCount,
						"webgl2-baked-conservative-overdraw-triangles":
							input.submitMetrics.bakedConservativeOverdrawTriangleCount,
						"webgl2-baked-draw-call-savings":
							input.submitMetrics.bakedDrawCallSavingsCount,
						"webgl2-baked-no-visible-routes":
							input.submitMetrics.bakedSubmitNoVisibleRouteCount,
						"webgl2-staged-atlas-draws":
							input.submitMetrics.stagedAtlasDrawCount,
						"webgl2-direct-packed-texture-page-draws":
							input.submitMetrics.directPackedTexturePageDrawCount,
						"webgl2-direct-single-entry-texture-page-draws":
							input.submitMetrics.directSingleEntryTexturePageDrawCount,
						"webgl2-staged-atlas-standalone-direct-draws":
							input.submitMetrics.stagedAtlasStandaloneDirectDrawCount,
						"webgl2-staged-atlas-estimated-texture-binds-avoided":
							input.submitMetrics.stagedAtlasEstimatedTextureBindAvoidedCount,
						"webgl2-staged-atlas-shared-texture-atlas-textures":
							input.submitMetrics.stagedAtlasSharedTextureAtlasTextureCount,
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
