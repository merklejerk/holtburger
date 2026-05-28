import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";
import type { WorldRenderMetrics } from "./renderer-contract";

const LUMA_STUB_CLASS_NAME = "world-display__luma-stub";

export function createLumaWorldDisplayRenderer(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
	let controlledCameraFrame = options.controlledCameraFrame;
	let renderMetricsChangeHandler = options.onRenderMetricsChange;

	const stubElement = document.createElement("div");
	stubElement.className = LUMA_STUB_CLASS_NAME;
	stubElement.textContent =
		"Luma renderer backend selected, but Phase 1 only provides a construction stub. Use VITE_HOLTBURGER_RENDER_BACKEND=three until Phase 2.";
	Object.assign(stubElement.style, {
		alignItems: "center",
		background: "#111827",
		boxSizing: "border-box",
		color: "#dbeafe",
		display: "flex",
		font: "13px/1.45 system-ui, sans-serif",
		height: "100%",
		justifyContent: "center",
		padding: "24px",
		textAlign: "center",
		width: "100%",
	});
	host.append(stubElement);
	reportMetrics();

	return {
		setAssetState() {
			reportMetrics();
		},
		setTerrainScene(scene) {
			terrainScene = scene;
			reportMetrics();
		},
		setStaticRenderableScene(scene) {
			staticRenderableScene = scene;
			reportMetrics();
		},
		setStructuredInteriorScene(scene) {
			structuredInteriorScene = scene;
			reportMetrics();
		},
		setTransitionPortalModel(model) {
			transitionPortalModel = model;
			reportMetrics();
		},
		setDebugOverlayScene() {
			reportMetrics();
		},
		setRenderSceneContext() {
			reportMetrics();
		},
		setRenderChunkTransforms() {
			reportMetrics();
		},
		setRenderSpatialQuery() {
			reportMetrics();
		},
		setControlledCameraFrame(frame) {
			controlledCameraFrame = frame;
			reportMetrics();
		},
		setTransitionPortalMaxDepth() {
			reportMetrics();
		},
		setRenderStyle() {
			reportMetrics();
		},
		setTextureFilteringMode() {
			reportMetrics();
		},
		setTextureColorSpaceMode() {
			reportMetrics();
		},
		setDetailTexturesEnabled() {
			reportMetrics();
		},
		setCameraFrameChangeHandler() {
			return;
		},
		setRenderMetricsChangeHandler(handler) {
			renderMetricsChangeHandler = handler;
			reportMetrics();
		},
		setCameraResidencyChangeHandler() {
			return;
		},
		pickTerrainLandblockAtViewportPoint() {
			return null;
		},
		pickAtViewportPoint() {
			return null;
		},
		dispose() {
			stubElement.remove();
		},
	};

	function reportMetrics(): void {
		renderMetricsChangeHandler?.(createStubMetrics());
	}

	function createStubMetrics(): WorldRenderMetrics {
		return {
			bounds: null,
			cameraFrame: controlledCameraFrame,
			performance: null,
			portal: {
				topologyOutdoorPortalCount: 0,
				apertureCandidateCount: transitionPortalModel.candidates.length,
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
				canvasWidth: host.clientWidth,
				canvasHeight: host.clientHeight,
				pixelRatio: window.devicePixelRatio,
				cameraViewResidency: "luma stub",
				residencyCellCount: 0,
				residencyLandblockCount: 0,
				residencyAabbCandidateCount: 0,
				residencyCellBspMatchCount: 0,
				residencyAabbFallbackCount: 0,
				residencySource: "unknown",
				renderGraphPolicy: "luma-stub",
				renderGraphBaseScene: "none",
				transitionPortalMaxDepth: 0,
				renderPassCount: 0,
				portalRenderWorkItemCount: 0,
				transitionApertureMaskPassCount: 0,
				apertureDepthResetPassCount: 0,
				interiorCompositePassCount: 0,
				exteriorCompositePassCount: 0,
				transitionPortalCandidateCount: transitionPortalModel.candidates.length,
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
				fallbackReasonCount: 1,
				fallbackReasonSamples: ["luma backend stub has no draw pipeline"],
				queryTimeMs: 0,
				debugOverlayObjectCount: 0,
				visibleDebugOverlayObjectCount: 0,
				materialCount: 0,
				materialProgramKeyCount: 0,
				transparentMaterialCount: 0,
				textureFilteringMode: options.textureFilteringMode ?? "anisotropic-4x",
				textureColorSpaceMode: options.textureColorSpaceMode ?? "auto",
				detailTexturesEnabled: options.detailTexturesEnabled ?? true,
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
				renderCalls: 0,
				renderTriangles: 0,
				renderLines: 0,
				renderPoints: 0,
			},
			geometry: {
				terrainTileCount: terrainScene.tiles.length,
				terrainVertexCount: terrainScene.tiles.reduce(
					(total, tile) => total + tile.mesh.vertices.length,
					0,
				),
				terrainTriangleCount: terrainScene.tiles.reduce(
					(total, tile) => total + tile.mesh.triangles.length,
					0,
				),
				staticRenderablePartCount: staticRenderableScene.parts.length,
				staticRenderableInstancedGroupCount:
					staticRenderableScene.partsByRenderGroupKey.size,
				structuredInteriorCellCount: structuredInteriorScene.cells.length,
				structuredInteriorVertexCount: structuredInteriorScene.cells.reduce(
					(total, cell) => total + cell.renderGeometry.vertexCount,
					0,
				),
				structuredInteriorTriangleCount: structuredInteriorScene.cells.reduce(
					(total, cell) => total + cell.renderGeometry.triangleCount,
					0,
				),
			},
		};
	}
}
