import type { SceneCameraFrame } from "./camera";
import type {
	WorldDisplayTextureColorSpaceMode,
	WorldDisplayTextureFilteringMode,
	WorldRenderMetrics,
} from "./renderer-contract";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";

export interface Webgl2RenderMetricsInput {
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	cameraFrame: SceneCameraFrame | null;
	canvasWidth: number;
	canvasHeight: number;
	pixelRatio: number;
	renderGraphPolicy: string;
	transitionPortalMaxDepth: number;
	clearCount: number;
	drawCallCount: number;
	lastFrameDrawCount: number;
	initializationError: string | null;
	performance: WorldRenderMetrics["performance"];
	textureFilteringMode: WorldDisplayTextureFilteringMode;
	textureColorSpaceMode: WorldDisplayTextureColorSpaceMode;
	detailTexturesEnabled: boolean;
}

export function createWebgl2RenderMetrics(
	input: Webgl2RenderMetricsInput,
): WorldRenderMetrics {
	return {
		bounds: null,
		cameraFrame: input.cameraFrame,
		performance: input.performance,
		portal: {
			topologyOutdoorPortalCount: 0,
			apertureCandidateCount: input.transitionPortalModel.candidates.length,
			renderWorkItemCandidateCount: 0,
			visiblePortalWorkItemCount: 0,
			maskedInteriorCellCount: 0,
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
				: "webgl2 test frame",
			residencyCellCount: 0,
			residencyLandblockCount: 0,
			residencyAabbCandidateCount: 0,
			residencyCellBspMatchCount: 0,
			residencyAabbFallbackCount: 0,
			residencySource: "unknown",
			renderGraphPolicy: input.renderGraphPolicy,
			renderGraphBaseScene: "none",
			transitionPortalMaxDepth: input.transitionPortalMaxDepth,
			renderPassCount: input.clearCount,
			clearCount: input.clearCount,
			portalRenderWorkItemCount: 0,
			transitionApertureMaskPassCount: 0,
			apertureDepthResetPassCount: 0,
			interiorCompositePassCount: 0,
			exteriorCompositePassCount: 0,
			transitionPortalCandidateCount:
				input.transitionPortalModel.candidates.length,
			portalApertureMeshCount: 0,
			terrainMeshCount: 0,
			visibleTerrainMeshCount: 0,
			staticGroupMeshCount: 0,
			visibleStaticGroupMeshCount: 0,
			staticRenderBatchCount: 0,
			staticBvhCandidateBatchCount: 0,
			staticBvhRepresentedInstanceKeyCount: 0,
			staticBvhVisibleInstanceKeyCount: 0,
			staticBvhFallbackIncludedBatchCount: 0,
			terrainRenderBatchCount: 0,
			terrainBvhCandidateBatchCount: 0,
			structuredInteriorRenderBatchCount: 0,
			structuredInteriorBvhCandidateBatchCount: 0,
			debugOverlayRenderBatchCount: 0,
			debugOverlayBvhCandidateBatchCount: 0,
			portalMaskRenderBatchCount: 0,
			portalMaskBvhCandidateBatchCount: 0,
			nonStaticBvhFallbackIncludedBatchCount: 0,
			portalCompositeVisibleItemKeyCount: 0,
			portalCompositeStaticCandidateBatchCount: 0,
			portalCompositeTerrainCandidateBatchCount: 0,
			portalCompositeInteriorCandidateBatchCount: 0,
			portalCompositeFallbackIncludedBatchCount: 0,
			structuredInteriorMeshCount: 0,
			visibleStructuredInteriorMeshCount: 0,
			terrainBvhVisibleItemCount: 0,
			terrainBvhTotalItemCount: 0,
			outdoorStaticBvhVisibleItemCount: 0,
			outdoorStaticBvhTotalItemCount: 0,
			envCellLocalBvhVisibleItemCount: 0,
			envCellLocalBvhTotalItemCount: 0,
			visibleStaticInstanceKeyCount: 0,
			visiblePortalKeyCount: 0,
			envCellBvhConsideredCount: 0,
			fallbackReasonCount: input.initializationError ? 1 : 0,
			fallbackReasonSamples: input.initializationError
				? [`webgl2 initialization failed: ${input.initializationError}`]
				: [],
			queryTimeMs: 0,
			debugOverlayObjectCount: 0,
			visibleDebugOverlayObjectCount: 0,
			materialCount: 0,
			materialProgramKeyCount: 0,
			transparentMaterialCount: 0,
			textureFilteringMode: input.textureFilteringMode,
			textureColorSpaceMode: input.textureColorSpaceMode,
			detailTexturesEnabled: input.detailTexturesEnabled,
			textureSamplingPolicyCounts: {},
			textureSamplingPolicySamples: [],
			textureVelocityPartCount: 0,
			textureVelocityRenderGroupCount: 0,
			textureVelocityMaterialCount: 0,
			textureVelocitySignatureCount: 0,
			textureVelocitySignatureSamples: [],
			textureResourceCount: 0,
			indexedTextureResourceCount: 0,
			paletteResourceCount: 0,
			staticGeometryGroupCount: 0,
			staticVisibleGeometryGroupCount: 0,
			structuredInteriorGeometryGroupCount: 0,
			materialTypeCounts: {},
			materialProgramKeySamples: [],
			preparedTextureUploadCount: 0,
			preparedTextureGeneratedByteLength: 0,
			compressedSingleLevelFallbackUploadCount: 0,
			renderCalls: input.lastFrameDrawCount,
			renderTriangles: input.lastFrameDrawCount,
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
