import type { SceneCameraFrame } from "./camera";
import type { LumaFrameMetrics } from "./luma-frame";
import type {
	WorldDisplayTextureColorSpaceMode,
	WorldDisplayTextureFilteringMode,
	WorldRenderMetrics,
} from "./renderer-contract";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";

export interface LumaRenderMetricsInput {
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	cameraFrame: SceneCameraFrame | null;
	canvasWidth: number;
	canvasHeight: number;
	pixelRatio: number;
	cameraViewResidency: string;
	renderGraphPolicy: string;
	clearCount: number;
	drawCallCount: number;
	lastFrameDrawCount: number;
	initializationError: string | null;
	terrainBatchCount?: number;
	structuredInteriorBatchCount?: number;
	staticBatchCount?: number;
	staticInstanceCount?: number;
	materialCount?: number;
	directTextureBatchCount?: number;
	textureResourceCount?: number;
	materialFallbackReasonCount?: number;
	materialFallbackReasonSamples?: readonly string[];
	lumaFrameMetrics?: LumaFrameMetrics | null;
	worldTriangleCount?: number;
	performance: WorldRenderMetrics["performance"];
	textureFilteringMode: WorldDisplayTextureFilteringMode;
	textureColorSpaceMode: WorldDisplayTextureColorSpaceMode;
	detailTexturesEnabled: boolean;
}

export function createLumaRenderMetrics(
	input: LumaRenderMetricsInput,
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
			rendererBackend: "luma",
			canvasWidth: input.canvasWidth,
			canvasHeight: input.canvasHeight,
			pixelRatio: input.pixelRatio,
			cameraViewResidency: input.cameraViewResidency,
			residencyCellCount: 0,
			residencyLandblockCount: 0,
			residencyAabbCandidateCount: 0,
			residencyCellBspMatchCount: 0,
			residencyAabbFallbackCount: 0,
			residencySource: "unknown",
			renderGraphPolicy: input.renderGraphPolicy,
			renderGraphBaseScene: "none",
			transitionPortalMaxDepth: 0,
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
			terrainMeshCount: input.terrainBatchCount ?? 0,
			visibleTerrainMeshCount: input.terrainBatchCount ?? 0,
			staticGroupMeshCount: input.staticBatchCount ?? 0,
			visibleStaticGroupMeshCount: input.staticBatchCount ?? 0,
			staticRenderBatchCount: input.staticBatchCount ?? 0,
			staticBvhCandidateBatchCount:
				(input.lumaFrameMetrics?.candidateCountsByCategory["static-staged"] ??
					0) +
				(input.lumaFrameMetrics?.candidateCountsByCategory.static ?? 0),
			staticBvhRepresentedInstanceKeyCount:
				(input.lumaFrameMetrics?.representedItemKeyCountsByCategory[
					"static-staged"
				] ?? 0) +
				(input.lumaFrameMetrics?.representedItemKeyCountsByCategory.static ??
					0),
			staticBvhVisibleInstanceKeyCount:
				(input.lumaFrameMetrics?.visibleDrawCountsByCategory[
					"static-staged"
				] ?? 0) +
				(input.lumaFrameMetrics?.visibleDrawCountsByCategory.static ?? 0),
			staticBvhFallbackIncludedBatchCount:
				(input.lumaFrameMetrics?.fallbackCountsByCategory["static-staged"] ??
					0) +
				(input.lumaFrameMetrics?.fallbackCountsByCategory.static ?? 0),
			terrainRenderBatchCount: input.terrainBatchCount ?? 0,
			terrainBvhCandidateBatchCount:
				input.lumaFrameMetrics?.candidateCountsByCategory.terrain ?? 0,
			structuredInteriorRenderBatchCount:
				input.structuredInteriorBatchCount ?? 0,
			structuredInteriorBvhCandidateBatchCount:
				input.lumaFrameMetrics?.candidateCountsByCategory[
					"structured-interior"
				] ?? 0,
			debugOverlayRenderBatchCount:
				input.lumaFrameMetrics?.candidateCountsByCategory["debug-overlay"] ?? 0,
			debugOverlayBvhCandidateBatchCount:
				input.lumaFrameMetrics?.visibleDrawCountsByCategory["debug-overlay"] ??
				0,
			portalMaskRenderBatchCount:
				input.lumaFrameMetrics?.candidateCountsByCategory["portal-mask"] ?? 0,
			portalMaskBvhCandidateBatchCount:
				input.lumaFrameMetrics?.visibleDrawCountsByCategory["portal-mask"] ??
				0,
			nonStaticBvhFallbackIncludedBatchCount:
				(input.lumaFrameMetrics?.fallbackCountsByCategory.terrain ?? 0) +
				(input.lumaFrameMetrics?.fallbackCountsByCategory[
					"structured-interior"
				] ?? 0) +
				(input.lumaFrameMetrics?.fallbackCountsByCategory["portal-mask"] ??
					0) +
				(input.lumaFrameMetrics?.fallbackCountsByCategory["debug-overlay"] ??
					0),
			portalCompositeVisibleItemKeyCount: 0,
			portalCompositeStaticCandidateBatchCount: 0,
			portalCompositeTerrainCandidateBatchCount: 0,
			portalCompositeInteriorCandidateBatchCount: 0,
			portalCompositeFallbackIncludedBatchCount: 0,
			structuredInteriorMeshCount: input.structuredInteriorBatchCount ?? 0,
			visibleStructuredInteriorMeshCount:
				input.structuredInteriorBatchCount ?? 0,
			terrainBvhVisibleItemCount:
				input.lumaFrameMetrics?.visibleDrawCountsByCategory.terrain ?? 0,
			terrainBvhTotalItemCount:
				input.lumaFrameMetrics?.candidateCountsByCategory.terrain ?? 0,
			outdoorStaticBvhVisibleItemCount:
				(input.lumaFrameMetrics?.visibleDrawCountsByCategory[
					"static-staged"
				] ?? 0),
			outdoorStaticBvhTotalItemCount:
				(input.lumaFrameMetrics?.candidateCountsByCategory["static-staged"] ??
					0),
			envCellLocalBvhVisibleItemCount:
				input.lumaFrameMetrics?.visibleItemKeyCount ?? 0,
			envCellLocalBvhTotalItemCount:
				input.lumaFrameMetrics?.representedItemKeyCount ?? 0,
			visibleStaticInstanceKeyCount: input.staticInstanceCount ?? 0,
			visiblePortalKeyCount: 0,
			envCellBvhConsideredCount: 0,
			fallbackReasonCount:
				(input.initializationError ? 1 : 0) +
				(input.materialFallbackReasonCount ?? 0) +
				(input.lumaFrameMetrics?.fallbackReasonCount ?? 0),
			fallbackReasonSamples: [
				...(input.initializationError
					? [`luma initialization failed: ${input.initializationError}`]
					: []),
				...(input.materialFallbackReasonSamples ?? []),
				...(input.lumaFrameMetrics?.fallbackReasonSamples ?? []),
			],
			queryTimeMs: 0,
			debugOverlayObjectCount: 0,
			visibleDebugOverlayObjectCount: 0,
			materialCount: input.materialCount ?? 0,
			materialProgramKeyCount: input.materialCount ?? 0,
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
			textureResourceCount: input.textureResourceCount ?? 0,
			indexedTextureResourceCount: 0,
			paletteResourceCount: 0,
			staticGeometryGroupCount: input.staticBatchCount ?? 0,
			staticVisibleGeometryGroupCount: input.staticBatchCount ?? 0,
			structuredInteriorGeometryGroupCount: 0,
			materialTypeCounts: {
				...(input.directTextureBatchCount
					? { "luma-direct-texture": input.directTextureBatchCount }
					: {}),
			},
			materialProgramKeySamples: [],
			preparedTextureUploadCount: 0,
			preparedTextureGeneratedByteLength: 0,
			compressedSingleLevelFallbackUploadCount: 0,
			renderCalls: input.lastFrameDrawCount,
			renderTriangles: input.worldTriangleCount ?? 0,
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
