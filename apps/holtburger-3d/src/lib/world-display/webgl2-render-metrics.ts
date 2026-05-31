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
			textureSamplingPolicySamples: [
				...(input.worldStore?.textureSamplingPolicySamples ?? []),
			],
			textureUploadSamples: [...(input.worldStore?.textureUploadSamples ?? [])],
			atlasEligibleMaterialCount:
				input.worldStore?.atlasEligibleMaterialCount ?? 0,
			atlasCandidateEntryCount: input.worldStore?.atlasCandidateEntryCount ?? 0,
			atlasCandidateMaterialSlotCount:
				input.worldStore?.atlasCandidateMaterialSlotCount ?? 0,
			atlasCandidateSamples: [
				...(input.worldStore?.atlasCandidateSamples ?? []),
			],
			atlasStaticCompactableDrawUnitCount:
				input.worldStore?.atlasStaticCompactableDrawUnitCount ?? 0,
			atlasStaticCompactionBypassReasonCount:
				input.worldStore?.atlasStaticCompactionBypassReasonCount ?? 0,
			atlasStaticCompactionBypassSamples: [
				...(input.worldStore?.atlasStaticCompactionBypassSamples ?? []),
			],
			atlasStaticGenerationTextureCount:
				input.worldStore?.atlasStaticGenerationTextureCount ?? 0,
			atlasStaticCompactedBatchCount:
				input.worldStore?.atlasStaticCompactedBatchCount ?? 0,
			atlasStaticCompactedDrawUnitCount:
				input.worldStore?.atlasStaticCompactedDrawUnitCount ?? 0,
			atlasStaticCompactedTriangleCount:
				input.worldStore?.atlasStaticCompactedTriangleCount ?? 0,
			atlasStaticCompactedVertexByteLength:
				input.worldStore?.atlasStaticCompactedVertexByteLength ?? 0,
			atlasStaticCompactedIndexByteLength:
				input.worldStore?.atlasStaticCompactedIndexByteLength ?? 0,
			atlasStaticCompactedTotalByteLength:
				input.worldStore?.atlasStaticCompactedTotalByteLength ?? 0,
			atlasStaticCompactedDrawSliceCount:
				input.worldStore?.atlasStaticCompactedDrawSliceCount ?? 0,
			atlasStaticCompactionResourceFallbackSamples: [
				...(input.worldStore?.atlasStaticCompactionResourceFallbackSamples ??
					[]),
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
						"webgl2-atlas-static-compactable":
							input.worldStore.atlasStaticCompactableDrawUnitCount,
						"webgl2-atlas-static-bypassed":
							input.worldStore.atlasStaticCompactionBypassReasonCount,
						"webgl2-atlas-static-generation-textures":
							input.worldStore.atlasStaticGenerationTextureCount,
						"webgl2-atlas-static-compacted-batches":
							input.worldStore.atlasStaticCompactedBatchCount,
						"webgl2-atlas-static-compacted-draw-units":
							input.worldStore.atlasStaticCompactedDrawUnitCount,
						"webgl2-atlas-static-compacted-draw-slices":
							input.worldStore.atlasStaticCompactedDrawSliceCount,
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
