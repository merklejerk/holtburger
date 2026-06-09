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
import { getPreparedAssetHotPathDiagnosticsSnapshot } from "../assets/prepared-asset-hot-path-diagnostics";

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
	resourcePolicy: string;
	baseSceneDomain: string;
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
	const assetHotPathDiagnostics = getPreparedAssetHotPathDiagnosticsSnapshot();
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
				: input.cameraViewResidency,
			residencyCellCount: input.residencyCellCount,
			residencyLandblockCount: input.residencyLandblockCount,
			residencyAabbCandidateCount: input.residencyAabbCandidateCount,
			residencyCellBspMatchCount: input.residencyCellBspMatchCount,
			residencyAabbFallbackCount: input.residencyAabbFallbackCount,
			residencySource: input.residencySource,
			resourcePolicy: input.resourcePolicy,
			baseSceneDomain: input.baseSceneDomain,
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
			rendererAssetSyncCount:
				assetHotPathDiagnostics.rendererAssetSyncCallCount,
			latestRendererAssetSyncRecommittedProductCount:
				assetHotPathDiagnostics.latestRendererAssetSync
					?.recommittedProductCount ?? 0,
			latestRendererAssetSyncScheduledFrame:
				assetHotPathDiagnostics.latestRendererAssetSync?.scheduledFrame ?? false,
			staticLandblockProductCount: input.worldStore
				? new Set(collectStaticLandblockProductIdentityKeys(input.worldStore))
						.size
				: 0,
			staticLandblockProductDomainCounts: input.worldStore
				? countProductDomains(
						collectStaticLandblockProductIdentityKeys(input.worldStore),
					)
				: {},
			staticBundleProductResourceCount:
				input.worldStore?.staticBundleLayerResources.productsByKey.size ?? 0,
			staticBundleProductDomainCounts: countProductDomains(
				input.worldStore?.staticBundleLayerResources.productsByKey.keys() ?? [],
			),
			staticBundleLayerResourceCount:
				input.worldStore?.staticBundleLayerResourceCount ?? 0,
			staticBundleLayerTexturePageResourceCount:
				input.worldStore?.staticBundleLayerTexturePageResourceCount ?? 0,
			structuredInteriorProductResourceCount:
				input.worldStore?.structuredInteriorProductResourceCount ?? 0,
			structuredInteriorProductDomainCounts: countProductDomains(
				input.worldStore?.structuredInteriorResources.productResourceKeyByProductKey.keys() ??
					[],
			),
			structuredInteriorCellResourceCount:
				input.worldStore?.structuredInteriorResourceCount ?? 0,
			structuredInteriorTexturePageResourceCount:
				input.worldStore?.structuredInteriorTexturePageResourceCount ?? 0,
			structuredInteriorMaterialRecordResourceCount:
				input.worldStore?.structuredInteriorMaterialRecordResourceCount ?? 0,
			terrainProductResourceCount:
				input.worldStore?.terrainTileIdsByProductKey.size ?? 0,
			terrainProductDomainCounts: countProductDomains(
				input.worldStore?.terrainTileIdsByProductKey.keys() ?? [],
			),
			productTerrainTexturePageCount:
				input.worldStore?.productTerrainTexturePagesByKey.size ?? 0,
			portalMaskProductResourceCount:
				input.worldStore?.transitionPortalMasks.length ?? 0,
			transitionPortalMaskResourceCount:
				input.worldStore?.transitionPortalMasks.length ?? 0,
			staticGroupMeshCount:
				input.worldStore?.staticBundleLayerResourceCount ?? 0,
			visibleStaticGroupMeshCount:
				input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0,
			staticRenderBatchCount:
				input.worldStore?.staticBundleLayerResourceCount ?? 0,
			staticBvhCandidateBatchCount:
				input.frameMetrics?.candidateCountsByCategory.static ?? 0,
			staticBvhRepresentedInstanceKeyCount:
				input.frameMetrics?.representedItemKeyCountsByCategory.static ?? 0,
			staticBvhVisibleInstanceKeyCount:
				input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0,
			staticBvhFallbackIncludedBatchCount:
				input.frameMetrics?.fallbackCountsByCategory.static ?? 0,
			terrainRenderBatchCount: input.worldStore?.terrainTileCount ?? 0,
			terrainBvhCandidateBatchCount:
				input.frameMetrics?.candidateCountsByCategory.terrain ?? 0,
			structuredInteriorRenderBatchCount:
				input.submitMetrics.materialSurfaceSubmittedCountsByDomain[
					"structured-interior"
				] + input.submitMetrics.structuredInteriorShellSubmittedCount,
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
				input.submitMetrics.portalMaskResourceCount,
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
			portalCompositeRectCount: input.portalCompositeRectCount,
			portalCompositeEstimatedPixelArea:
				input.portalCompositeEstimatedPixelArea,
			portalCompositeMaxDepth: input.portalCompositeMaxDepth,
			structuredInteriorMeshCount:
				input.worldStore?.structuredInteriorResourceCount ?? 0,
			visibleStructuredInteriorMeshCount:
				input.submitMetrics.materialSurfaceSubmittedCountsByDomain[
					"structured-interior"
				] + input.submitMetrics.structuredInteriorShellSubmittedCount,
			terrainBvhVisibleItemCount:
				input.frameMetrics?.visibleDrawCountsByCategory.terrain ?? 0,
			terrainBvhTotalItemCount:
				input.frameMetrics?.candidateCountsByCategory.terrain ?? 0,
			outdoorStaticBvhVisibleItemCount:
				input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0,
			outdoorStaticBvhTotalItemCount:
				input.frameMetrics?.candidateCountsByCategory.static ?? 0,
			envCellLocalBvhVisibleItemCount:
				input.frameMetrics?.visibleItemKeyCount ?? 0,
			envCellLocalBvhTotalItemCount:
				input.frameMetrics?.representedItemKeyCount ?? 0,
			visibleStaticInstanceKeyCount:
				input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0,
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
			atlasFailureReasonCount: input.worldStore?.atlasFailureReasonCount ?? 0,
			atlasFailureSamples: [...(input.worldStore?.atlasFailureSamples ?? [])],
			terrainTexturePageCount:
				input.worldStore?.terrainTexturePageCount ?? 0,
			terrainDetailTexturePageCount:
				input.worldStore?.terrainDetailTexturePageCount ?? 0,
			visibleStaticBundleLayerCount:
				input.submitMetrics.visibleStaticBundleLayerCount,
			staticBundleLayerSubmittedCount:
				input.submitMetrics.staticBundleLayerSubmittedCount,
			staticBundleSelectedObjectRecordCount:
				input.submitMetrics.staticBundleSelectedObjectRecordCount,
			staticBundleSelectedSpatialHintCount:
				input.submitMetrics.staticBundleSelectedSpatialHintCount,
			staticBundleSelectedSourceObjectCount:
				input.submitMetrics.staticBundleSelectedSourceObjectCount,
			staticBundleSelectedCompactedBatchCount:
				input.submitMetrics.staticBundleSelectedCompactedBatchCount,
			staticBundleSelectedDirectEntryCount:
				input.submitMetrics.staticBundleSelectedDirectEntryCount,
			staticBundleSelectedNoGeometryLayerCount:
				input.submitMetrics.staticBundleSelectedNoGeometryLayerCount,
			staticBundleSelectedUnsubmittedLayerCount:
				input.submitMetrics.staticBundleSelectedUnsubmittedLayerCount,
			staticBundleSelectedMissingMaterialGeometryCount:
				input.submitMetrics.staticBundleSelectedMissingMaterialGeometryCount,
			staticBundleBuilderSkippedSurfaceCount:
				input.submitMetrics.staticBundleBuilderSkippedSurfaceCount,
			staticBundleBuilderSkippedReasonCounts: {
				...input.submitMetrics.staticBundleBuilderSkippedReasonCounts,
			},
			staticBundleGeometryCandidateTriangleCount:
				input.submitMetrics.staticBundleGeometryCandidateTriangleCount,
			staticBundleSelectedLayerCoverageSamples: [
				...input.submitMetrics.staticBundleSelectedLayerCoverageSamples,
			],
			staticBundleGeometryCandidateCount:
				input.submitMetrics.staticBundleGeometryCandidateCount,
			staticBundleMaterialRecordCount:
				input.submitMetrics.staticBundleMaterialRecordCount,
			staticBundleMaterialFamilyCounts: {
				...input.submitMetrics.staticBundleMaterialFamilyCounts,
			},
			staticBundleMaterialAlphaPolicyCounts: {
				...input.submitMetrics.staticBundleMaterialAlphaPolicyCounts,
			},
			staticBundleMaterialBindingUsageCounts: {
				...input.submitMetrics.staticBundleMaterialBindingUsageCounts,
			},
			staticBundleMaterialBaseColorBindingCount:
				input.submitMetrics.staticBundleMaterialBaseColorBindingCount,
			staticBundleMaterialIndexedBindingCount:
				input.submitMetrics.staticBundleMaterialIndexedBindingCount,
			materialSurfaceSubmittedCount:
				input.submitMetrics.materialSurfaceSubmittedCount,
			materialSurfaceSubmittedCountsByDomain: {
				...input.submitMetrics.materialSurfaceSubmittedCountsByDomain,
			},
			materialSurfaceDrawCallCountsByDomain: {
				...input.submitMetrics.materialSurfaceDrawCallCountsByDomain,
			},
			materialSurfaceTriangleCountsByDomain: {
				...input.submitMetrics.materialSurfaceTriangleCountsByDomain,
			},
			materialSurfaceSkippedCount: input.submitMetrics.materialSurfaceSkippedCount,
			materialSurfaceSkippedCountsByDomain: {
				...input.submitMetrics.materialSurfaceSkippedCountsByDomain,
			},
			materialSurfaceSubmittedAlphaPolicyCounts: {
				...input.submitMetrics.materialSurfaceSubmittedAlphaPolicyCounts,
			},
			materialSurfaceSkippedReasonCounts: {
				...input.submitMetrics.materialSurfaceSkippedReasonCounts,
			},
			materialSurfaceSkippedFamilyCounts: {
				...input.submitMetrics.materialSurfaceSkippedFamilyCounts,
			},
			materialSurfaceSkippedAlphaPolicyCounts: {
				...input.submitMetrics.materialSurfaceSkippedAlphaPolicyCounts,
			},
			materialSurfaceSkippedBindingUsageCounts: {
				...input.submitMetrics.materialSurfaceSkippedBindingUsageCounts,
			},
			materialSurfaceSubmitFallbackSamples: [
				...input.submitMetrics.materialSurfaceSubmitFallbackSamples,
			],
			textureVelocityPartCount: 0,
			textureVelocityRenderGroupCount: 0,
			textureVelocityMaterialCount: 0,
			textureVelocitySignatureCount: 0,
			textureVelocitySignatureSamples: [],
			textureResourceCount: input.worldStore?.textureCount ?? 0,
			indexedTextureResourceCount: input.worldStore?.indexedTextureCount ?? 0,
			paletteResourceCount: input.worldStore?.paletteTextureCount ?? 0,
			staticGeometryGroupCount:
				input.worldStore?.staticBundleLayerResourceCount ?? 0,
			staticVisibleGeometryGroupCount:
				input.frameMetrics?.visibleDrawCountsByCategory.static ?? 0,
			structuredInteriorGeometryGroupCount:
				input.worldStore?.structuredInteriorResourceCount ?? 0,
			materialTypeCounts: input.worldStore
				? {
						"webgl2-atlas-eligible":
							input.worldStore.texturePageReadyMaterialCount,
						"webgl2-atlas-failures": input.worldStore.atlasFailureReasonCount,
						"webgl2-terrain-texture-pages":
							input.worldStore.terrainTexturePageCount,
						"webgl2-terrain-detail-texture-pages":
							input.worldStore.terrainDetailTexturePageCount,
						"webgl2-detail-overlay": input.worldStore.detailTextureCount,
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
			renderCalls: input.submitMetrics.drawCallCount || input.lastFrameDrawCount,
			renderTriangles: input.submitMetrics.triangleCount,
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

function collectStaticLandblockProductIdentityKeys(
	worldStore: Webgl2WorldResourceStore,
): string[] {
	return [
		...worldStore.staticBundleLayerResources.productsByKey.keys(),
		...worldStore.structuredInteriorResources.productResourceKeyByProductKey.keys(),
		...worldStore.terrainTileIdsByProductKey.keys(),
	];
}

function countProductDomains(productKeys: Iterable<string>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const key of new Set(productKeys)) {
		const product = key.split(":")[2] ?? "unknown";
		counts[product] = (counts[product] ?? 0) + 1;
	}
	return counts;
}
