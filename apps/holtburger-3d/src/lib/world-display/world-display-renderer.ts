import {
	AmbientLight,
	AlwaysStencilFunc,
	Box3,
	BufferAttribute,
	BufferGeometry,
	Color,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	EqualStencilFunc,
	Frustum,
	Group,
	InstancedMesh,
	KeepStencilOp,
	LineBasicMaterial,
	LineLoop,
	LineSegments,
	Matrix4,
	type Material,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PerspectiveCamera,
	ReplaceStencilOp,
	Scene,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";

import type { AssetChannelState } from "../assets/types";
import type { NormalizedViewportPoint } from "./model";
import type {
	CellDebugOverlay,
	PortalDebugOverlay,
	WorldDebugOverlayModel,
} from "./debug-overlays";
import type {
	RenderFrustum,
	RenderSpatialIndexQuery,
	RenderSpatialItemKind,
	RenderSpatialPick,
} from "./render-spatial-index";
import {
	debugCellSpatialItemId,
	portalSpatialItemId,
	structuredCellSpatialItemId,
	terrainSpatialItemId,
} from "./render-spatial-ids";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderChunkKey } from "./render-chunks";
import {
	type StaticRenderablePart,
	type StaticRenderableSceneModel,
	isPreparedGfxObjAsset,
} from "./static-renderables";
import {
	buildAcPlacementMatrix,
	buildGfxObjGeometry,
	buildStaticRenderableColor,
	buildStaticRenderablePartMatrix,
} from "./static-renderable-geometry";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import {
	createFallbackSceneCameraFrame,
	fitSceneCameraFrameToBounds,
	type SceneBoundsFrame,
	type SceneCameraFrame,
} from "./camera";
import type {
	WorldRenderCameraFrameChangeHandler,
	WorldRenderDebugMetrics,
	WorldRenderMetrics,
	WorldRenderMetricsChangeHandler,
	WorldRenderPortalMetrics,
} from "./renderer-contract";
import type {
	OutdoorPortalViewGroup,
	OutdoorPortalViewGroupModel,
} from "./outdoor-portal-view-groups";
import { buildTerrainGeometry } from "./terrain-geometry";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import {
	syncRenderChunkRootRecords,
	type RenderChunkRootRecord,
} from "./chunk-root-manager";
import {
	WORLD_RENDER_LAYER,
	deriveWorldRenderPasses,
	staticRenderableLayerForKind,
	type WorldRenderPass,
} from "./render-passes";
import {
	evaluatePortalVisibility,
	type PortalVisibilityResult,
} from "./portal-visibility";

export interface WorldDisplayRendererOptions {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	outdoorPortalViewGroupModel: OutdoorPortalViewGroupModel;
	debugOverlayScene: WorldDebugOverlayModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	renderSpatialQuery: RenderSpatialIndexQuery | null;
	controlledCameraFrame: SceneCameraFrame | null;
	onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
	onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
}

export interface WorldDisplayRenderer {
	setAssetState(assetState: AssetChannelState): void;
	setTerrainScene(scene: TerrainSceneModel): void;
	setStaticRenderableScene(scene: StaticRenderableSceneModel): void;
	setStructuredInteriorScene(scene: StructuredInteriorSceneModel): void;
	setOutdoorPortalViewGroupModel(model: OutdoorPortalViewGroupModel): void;
	setDebugOverlayScene(scene: WorldDebugOverlayModel): void;
	setRenderChunkTransforms(transforms: readonly RenderChunkTransform[]): void;
	setRenderSpatialQuery(query: RenderSpatialIndexQuery | null): void;
	setControlledCameraFrame(frame: SceneCameraFrame | null): void;
	setCameraFrameChangeHandler(
		handler: WorldRenderCameraFrameChangeHandler | undefined,
	): void;
	setRenderMetricsChangeHandler(
		handler: WorldRenderMetricsChangeHandler | undefined,
	): void;
	pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null;
	pickAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null;
	dispose(): void;
}

const PERFORMANCE_REPORT_INTERVAL_MS = 500;
const UNFOCUSED_MAX_RENDER_FPS = 15;
const UNFOCUSED_RENDER_INTERVAL_MS = 1000 / UNFOCUSED_MAX_RENDER_FPS;
const SELECTED_DEBUG_EDGE_RADIUS = 0.12;
const MIN_PORTAL_SCREEN_AREA_PX = 1;

export function createWorldDisplayRenderer(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let assetState = options.assetState;
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let outdoorPortalViewGroupModel = options.outdoorPortalViewGroupModel;
	let debugOverlayScene = options.debugOverlayScene;
	let renderChunkTransforms = options.renderChunkTransforms;
	let renderSpatialQuery = options.renderSpatialQuery;
	let controlledCameraFrame = options.controlledCameraFrame;
	let onCameraFrameChange = options.onCameraFrameChange;
	let onRenderMetricsChange = options.onRenderMetricsChange;

	const renderer = new WebGLRenderer({
		antialias: true,
		alpha: true,
		stencil: true,
	});
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.outputColorSpace = "srgb";
	renderer.autoClear = false;
	renderer.info.autoReset = false;
	renderer.setClearColor(new Color("#0e1a24"), 1);
	renderer.domElement.className = "world-display__three-canvas";
	host.append(renderer.domElement);

	const scene = new Scene();

	const camera = new PerspectiveCamera(52, 1, 0.1, 5000);

	const ambientLight = new AmbientLight("#d7e9f9", 1.4);
	const sunLight = new DirectionalLight("#fff1d6", 2.1);
	sunLight.position.set(220, 320, 160);
	enableAllWorldRenderLayers(ambientLight);
	enableAllWorldRenderLayers(sunLight);
	scene.add(ambientLight, sunLight);

	const chunkRootContainer = new Group();
	chunkRootContainer.name = "render-chunk-roots";
	scene.add(chunkRootContainer);

	let activeCameraFrame: SceneCameraFrame | null = null;
	const terrainMeshes = new Map<string, Mesh>();
	const staticGeometryCache = new Map<string, BufferGeometry>();
	const staticRenderableGroupMeshes = new Map<string, InstancedMesh>();
	const structuredInteriorMeshes = new Map<string, Mesh>();
	const portalMaskMeshes = new Map<string, Mesh>();
	const debugOverlayObjects = new Map<string, Object3D>();
	const chunkRoots = new Map<RenderChunkKey, RenderChunkRootRecord<Group>>();
	let lastReportedMetricsKey: string | null = null;
	let latestPerformanceMetrics: WorldRenderMetrics["performance"] = null;
	let latestPortalMetrics: WorldRenderPortalMetrics =
		createPortalRenderMetrics(outdoorPortalViewGroupModel);
	let latestRenderDebugMetrics: WorldRenderDebugMetrics =
		createRenderDebugMetrics(renderer, {
			renderPassCount: 0,
			portalGroupCount: 0,
			portalMaskMeshCount: 0,
			terrainMeshCount: 0,
			visibleTerrainMeshCount: 0,
			staticGroupMeshCount: 0,
			visibleStaticGroupMeshCount: 0,
			structuredInteriorMeshCount: 0,
			visibleStructuredInteriorMeshCount: 0,
			debugOverlayObjectCount: 0,
			visibleDebugOverlayObjectCount: 0,
		});
	let frameId = 0;
	let lastFrameAt: number | null = null;
	let lastRenderedAt: number | null = null;
	let performanceWindowStartedAt = 0;
	let performanceWindowFrameCount = 0;
	let performanceWindowFrameMs = 0;
	let performanceWindowRenderMs = 0;
	let isReducedFrameRateActive = shouldUseReducedFrameRate();
	let disposed = false;

	const resizeObserver = new ResizeObserver(() => {
		syncRendererSize();
		updateCameraFrame();
	});
	resizeObserver.observe(host);

	window.addEventListener("focus", syncReducedFrameRateState);
	window.addEventListener("blur", syncReducedFrameRateState);
	document.addEventListener("visibilitychange", syncReducedFrameRateState);

	syncRendererSize();
	frameId = window.requestAnimationFrame(renderFrame);

	return {
		setAssetState(nextAssetState) {
			assetState = nextAssetState;
		},
		setTerrainScene(nextScene) {
			terrainScene = nextScene;
			syncTerrainMeshes(nextScene);
		},
		setStaticRenderableScene(nextScene) {
			staticRenderableScene = nextScene;
			syncStaticRenderableMeshes(nextScene);
		},
		setStructuredInteriorScene(nextScene) {
			structuredInteriorScene = nextScene;
			syncStructuredInteriorMeshes(nextScene);
		},
		setOutdoorPortalViewGroupModel(nextModel) {
			outdoorPortalViewGroupModel = nextModel;
			syncPortalMaskMeshes(nextModel);
		},
		setDebugOverlayScene(nextScene) {
			debugOverlayScene = nextScene;
			syncDebugOverlayMeshes(nextScene);
		},
		setRenderChunkTransforms(nextTransforms) {
			renderChunkTransforms = nextTransforms;
			syncRenderChunkRoots(nextTransforms);
		},
		setRenderSpatialQuery(nextQuery) {
			renderSpatialQuery = nextQuery;
		},
		setControlledCameraFrame(nextFrame) {
			controlledCameraFrame = nextFrame;
			updateCameraFrame();
		},
		setCameraFrameChangeHandler(handler) {
			onCameraFrameChange = handler;
		},
		setRenderMetricsChangeHandler(handler) {
			onRenderMetricsChange = handler;
			reportRenderMetrics();
		},
		pickTerrainLandblockAtViewportPoint(viewportPoint) {
			const pick = this.pickAtViewportPoint(
				viewportPoint,
				new Set(["terrain"]),
			);
			return pick?.item.metadata.kind === "terrain"
				? pick.item.metadata.landblockId
				: null;
		},
		pickAtViewportPoint(viewportPoint, mask, ownerKeys) {
			if (!renderSpatialQuery) {
				return null;
			}
			const ray = buildViewportRay(viewportPoint);
			return renderSpatialQuery.pickRay(ray, mask, ownerKeys);
		},
		dispose,
	};

	function renderFrame(frameAt: number): void {
		frameId = window.requestAnimationFrame(renderFrame);
		if (disposed) {
			return;
		}
		syncSpatialVisibility();
		syncReducedFrameRateState();
		if (
			isReducedFrameRateActive &&
			lastRenderedAt !== null &&
			frameAt - lastRenderedAt < UNFOCUSED_RENDER_INTERVAL_MS
		) {
			return;
		}

		const frameStartedAt = frameAt;
		const renderStartedAt = window.performance.now();
		renderWorldPasses();
		const renderMs = window.performance.now() - renderStartedAt;
		lastRenderedAt = frameStartedAt;
		if (lastFrameAt !== null) {
			const frameMs = frameStartedAt - lastFrameAt;
			performanceWindowFrameCount += 1;
			performanceWindowFrameMs += frameMs;
			performanceWindowRenderMs += renderMs;
			if (
				frameStartedAt - performanceWindowStartedAt >=
				PERFORMANCE_REPORT_INTERVAL_MS
			) {
				const averageFrameMs =
					performanceWindowFrameMs / performanceWindowFrameCount;
				const averageRenderMs =
					performanceWindowRenderMs / performanceWindowFrameCount;
				latestPerformanceMetrics = {
					fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
					frameMs: averageFrameMs,
					renderMs: averageRenderMs,
				};
				performanceWindowStartedAt = frameStartedAt;
				performanceWindowFrameCount = 0;
				performanceWindowFrameMs = 0;
				performanceWindowRenderMs = 0;
				reportRenderMetrics();
			}
		} else {
			performanceWindowStartedAt = frameStartedAt;
		}
		lastFrameAt = frameStartedAt;
	}

	function resetPerformanceWindow(): void {
		lastFrameAt = null;
		lastRenderedAt = null;
		performanceWindowStartedAt = window.performance.now();
		performanceWindowFrameCount = 0;
		performanceWindowFrameMs = 0;
		performanceWindowRenderMs = 0;
	}

	function syncReducedFrameRateState(): void {
		const nextState = shouldUseReducedFrameRate();
		if (nextState === isReducedFrameRateActive) {
			return;
		}

		isReducedFrameRateActive = nextState;
		resetPerformanceWindow();
	}

	function syncRendererSize(): void {
		const width = Math.max(host.clientWidth, 1);
		const height = Math.max(host.clientHeight, 1);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	function syncRenderChunkRoots(
		transforms: readonly RenderChunkTransform[],
	): void {
		syncRenderChunkRootRecords(chunkRoots, transforms, {
			createRoot: createRenderChunkRoot,
			updateRootPosition: updateRenderChunkRootPosition,
			canDisposeRoot: (root) => root.children.length === 0,
			disposeRoot: disposeRenderChunkRoot,
		});
		updateCameraFrame();
		reportRenderMetrics();
	}

	function createRenderChunkRoot(transform: RenderChunkTransform): Group {
		const root = new Group();
		root.name = `render-chunk/${transform.chunkKey}`;
		root.userData.chunkKey = transform.chunkKey;
		root.userData.chunkLandblockId = transform.chunkLandblockId;
		enableAllWorldRenderLayers(root);
		chunkRootContainer.add(root);
		return root;
	}

	function renderWorldPasses(): void {
		latestPortalMetrics = createPortalRenderMetrics(outdoorPortalViewGroupModel);
		renderer.info.reset();
		const passes = deriveWorldRenderPasses({
			hasPortalViewGroups: outdoorPortalViewGroupModel.groups.length > 0,
			showDiagnosticInterior: true,
			showDebugOverlays: true,
		});
		for (const pass of passes) {
			if (pass.kind === "portal-stencil-mask") {
				renderPortalGroups();
				continue;
			}
			if (pass.kind === "portal-composited-interior") {
				continue;
			}
			applyPassClear(pass);
			camera.layers.set(pass.layer);
			renderer.render(scene, camera);
		}
		camera.layers.enableAll();
		latestRenderDebugMetrics = createRenderDebugMetrics(renderer, {
			renderPassCount: passes.length,
			portalGroupCount: outdoorPortalViewGroupModel.groups.length,
			portalMaskMeshCount: portalMaskMeshes.size,
			terrainMeshCount: terrainMeshes.size,
			visibleTerrainMeshCount: countVisibleObjects(terrainMeshes.values()),
			staticGroupMeshCount: staticRenderableGroupMeshes.size,
			visibleStaticGroupMeshCount: countVisibleObjects(
				staticRenderableGroupMeshes.values(),
			),
			structuredInteriorMeshCount: structuredInteriorMeshes.size,
			visibleStructuredInteriorMeshCount: countVisibleObjects(
				structuredInteriorMeshes.values(),
			),
			debugOverlayObjectCount: debugOverlayObjects.size,
			visibleDebugOverlayObjectCount: countVisibleObjects(
				debugOverlayObjects.values(),
			),
		});
	}

	function applyPassClear(pass: WorldRenderPass): void {
		const { color, depth, stencil } = pass.clearBeforePass;
		if (color || depth || stencil) {
			renderer.clear(color, depth, stencil);
		}
	}

	function renderPortalGroups(): void {
		const visibleGroups: {
			group: OutdoorPortalViewGroup;
			screenAreaPx: number;
		}[] = [];
		const maskedInteriorCellIds = new Set<number>();
		for (const group of outdoorPortalViewGroupModel.groups) {
			const visibility = evaluatePortalViewGroupVisibility(group);
			if (!visibility.visible) {
				recordPortalVisibilitySkip(visibility.reason);
				continue;
			}
			visibleGroups.push({
				group,
				screenAreaPx: visibility.screenAreaPx,
			});
			for (const envCellId of group.requestedInteriorEnvCellIds) {
				maskedInteriorCellIds.add(envCellId);
			}
		}
		visibleGroups.sort(
			(left, right) =>
				right.screenAreaPx - left.screenAreaPx ||
				left.group.id.localeCompare(right.group.id),
		);
		latestPortalMetrics.visiblePortalGroupCount = visibleGroups.length;
		latestPortalMetrics.maskedInteriorCellCount = maskedInteriorCellIds.size;

		for (const { group } of visibleGroups) {
			const maskMesh = portalMaskMeshes.get(group.id);
			if (!maskMesh) {
				continue;
			}

			setPortalMaskVisibility(group.id);
			renderer.clear(false, false, true);
			camera.layers.set(WORLD_RENDER_LAYER.portalMask);
			renderer.render(scene, camera);

			setPortalInteriorVisibility(group);
			applyPortalInteriorStencil(group.stencilRef);
			camera.layers.set(WORLD_RENDER_LAYER.portalInterior);
			renderer.render(scene, camera);
		}

		setPortalMaskVisibility(null);
		clearPortalInteriorStencil();
		restorePortalInteriorVisibility();
		syncSpatialVisibility();
	}

	function evaluatePortalViewGroupVisibility(
		group: OutdoorPortalViewGroup,
	): PortalVisibilityResult {
		const maskMesh = portalMaskMeshes.get(group.id);
		if (!maskMesh) {
			return { visible: false, reason: "missing-points", screenAreaPx: 0 };
		}

		maskMesh.updateMatrixWorld(true);
		const worldPoints = group.aperture.points.map((point) =>
			new Vector3(point.x, point.y, point.z).applyMatrix4(maskMesh.matrixWorld),
		);
		return evaluatePortalVisibility({
			worldPoints: worldPoints.map((point) => ({
				x: point.x,
				y: point.y,
				z: point.z,
			})),
			camera,
			viewport: new Vector2(renderer.domElement.width, renderer.domElement.height),
			minScreenAreaPx: MIN_PORTAL_SCREEN_AREA_PX,
		});
	}

	function recordPortalVisibilitySkip(
		reason: PortalVisibilityResult["reason"],
	): void {
		switch (reason) {
			case "outside-frustum":
				latestPortalMetrics.skippedOutsideFrustumCount += 1;
				return;
			case "back-facing":
				latestPortalMetrics.skippedBackFacingCount += 1;
				return;
			case "too-small":
				latestPortalMetrics.skippedTooSmallCount += 1;
				return;
			case "missing-points":
			case "visible":
				return;
		}
	}

	function updateRenderChunkRootPosition(
		root: Group,
		offset: RenderChunkTransform["offset"],
	): void {
		root.position.set(offset.x, offset.y, offset.z);
		root.updateMatrixWorld(true);
	}

	function disposeRenderChunkRoot(root: Group): void {
		if (root.children.length > 0) {
			throw new Error(
				`Cannot dispose non-empty render chunk root ${root.name}. Move or dispose layer objects before removing the chunk.`,
			);
		}
		root.removeFromParent();
	}

	function getRenderChunkRoot(chunkKey: RenderChunkKey): Group {
		const record = chunkRoots.get(chunkKey);
		if (!record) {
			throw new Error(`Missing render chunk root ${chunkKey}.`);
		}
		return record.root;
	}

	function resolveControlledCameraFrame(
		frame: SceneCameraFrame,
	): SceneCameraFrame {
		const aspect = camera.aspect;
		if (frame.aspect === aspect) {
			return frame;
		}
		return { ...frame, aspect };
	}

	function syncTerrainMeshes(sceneModel: TerrainSceneModel): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const activeAssetIds = new Set(
			sceneModel.tiles.map((tile) => tile.assetId),
		);
		for (const [assetId, mesh] of terrainMeshes.entries()) {
			if (activeAssetIds.has(assetId)) {
				continue;
			}

			mesh.removeFromParent();
			disposeMesh(mesh);
			terrainMeshes.delete(assetId);
		}

		for (const tile of sceneModel.tiles) {
			const chunkRoot = getRenderChunkRoot(tile.renderChunk.chunkKey);
			const existing = terrainMeshes.get(tile.assetId);
			if (existing) {
				chunkRoot.attach(existing);
				existing.position.set(
					tile.chunkLocalOffset.x,
					tile.chunkLocalOffset.y,
					tile.chunkLocalOffset.z,
				);
				continue;
			}

			const mesh = createTerrainTileMesh(tile);
			mesh.position.set(
				tile.chunkLocalOffset.x,
				tile.chunkLocalOffset.y,
				tile.chunkLocalOffset.z,
			);
			mesh.userData.landblockId = tile.landblockId;
			mesh.userData.spatialItemId = terrainSpatialItemId(tile.assetId);
			mesh.layers.set(WORLD_RENDER_LAYER.exterior);
			chunkRoot.add(mesh);
			terrainMeshes.set(tile.assetId, mesh);
		}
		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function buildViewportRay(viewportPoint: NormalizedViewportPoint): {
		origin: { x: number; y: number; z: number };
		direction: { x: number; y: number; z: number };
	} {
		const normalizedDevicePoint = new Vector2(
			viewportPoint.normalizedX * 2 - 1,
			-(viewportPoint.normalizedY * 2 - 1),
		);
		const origin = new Vector3();
		camera.getWorldPosition(origin);
		const direction = new Vector3(
			normalizedDevicePoint.x,
			normalizedDevicePoint.y,
			0.5,
		)
			.unproject(camera)
			.sub(origin)
			.normalize();
		return {
			origin: { x: origin.x, y: origin.y, z: origin.z },
			direction: { x: direction.x, y: direction.y, z: direction.z },
		};
	}

	function syncSpatialVisibility(): void {
		if (!renderSpatialQuery) {
			setAllSpatiallyCullableObjectsVisible(true);
			return;
		}

		const visibleItemIds = new Set(
			renderSpatialQuery
				.queryFrustum(
					buildCameraRenderFrustum(),
					new Set(["terrain", "structured-cell", "portal"]),
				)
				.map((item) => item.id),
		);

		for (const [assetId, mesh] of terrainMeshes.entries()) {
			applySpatialVisibility(
				mesh,
				terrainSpatialItemId(assetId),
				visibleItemIds,
			);
		}
		for (const [renderKey, mesh] of structuredInteriorMeshes.entries()) {
			applySpatialVisibility(
				mesh,
				structuredCellSpatialItemId(renderKey),
				visibleItemIds,
			);
		}
		for (const [spatialItemId, object] of debugOverlayObjects.entries()) {
			applySpatialVisibility(object, spatialItemId, visibleItemIds);
		}
	}

	function applySpatialVisibility(
		object: Object3D,
		spatialItemId: string,
		visibleItemIds: ReadonlySet<string>,
	): void {
		object.visible =
			!renderSpatialQuery?.hasItem(spatialItemId) ||
			visibleItemIds.has(spatialItemId);
	}

	function setAllSpatiallyCullableObjectsVisible(visible: boolean): void {
		for (const mesh of terrainMeshes.values()) {
			mesh.visible = visible;
		}
		for (const mesh of structuredInteriorMeshes.values()) {
			mesh.visible = visible;
		}
		for (const object of debugOverlayObjects.values()) {
			object.visible = visible;
		}
	}

	function buildCameraRenderFrustum(): RenderFrustum {
		camera.updateMatrixWorld();
		const projectionScreenMatrix = new Matrix4().multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse,
		);
		const frustum = new Frustum().setFromProjectionMatrix(
			projectionScreenMatrix,
		);
		return {
			planes: frustum.planes.map((plane) => ({
				normal: {
					x: plane.normal.x,
					y: plane.normal.y,
					z: plane.normal.z,
				},
				constant: plane.constant,
			})),
		};
	}

	function updateCameraFrame(): void {
		if (controlledCameraFrame) {
			setActiveCameraFrame(
				resolveControlledCameraFrame(controlledCameraFrame),
				{
					notifyParent: false,
				},
			);
			reportRenderMetrics();
			return;
		}

		if (
			terrainScene.tiles.length === 0 &&
			staticRenderableScene.parts.length === 0 &&
			structuredInteriorScene.cells.length === 0
		) {
			applyInternalCameraFrame(null);
			return;
		}

		const boundsFrame = calculateSceneBoundsFrame();
		if (!boundsFrame) {
			return;
		}
		applyInternalCameraFrame(boundsFrame);
		reportRenderMetrics();
	}

	function applyInternalCameraFrame(
		boundsFrame: SceneBoundsFrame | null,
	): void {
		const aspect = camera.aspect || 1;
		const frame = boundsFrame
			? fitSceneCameraFrameToBounds(boundsFrame, aspect)
			: createFallbackSceneCameraFrame(aspect);
		setActiveCameraFrame(frame, { notifyParent: true });
		reportRenderMetrics();
	}

	function setActiveCameraFrame(
		frame: SceneCameraFrame,
		options: { notifyParent: boolean },
	): void {
		activeCameraFrame = frame;
		applySceneCameraFrame(activeCameraFrame);
		if (options.notifyParent) {
			onCameraFrameChange?.(frame);
		}
	}

	function applySceneCameraFrame(frame: SceneCameraFrame): void {
		camera.fov = frame.fovDegrees;
		camera.aspect = frame.aspect;
		camera.near = frame.near;
		camera.far = frame.far;
		camera.position.set(frame.position.x, frame.position.y, frame.position.z);
		camera.up.set(frame.up.x, frame.up.y, frame.up.z);
		camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
		camera.updateProjectionMatrix();
	}

	function calculateSceneBoundsFrame(): SceneBoundsFrame | null {
		if (
			terrainScene.tiles.length === 0 &&
			staticRenderableScene.parts.length === 0 &&
			structuredInteriorScene.cells.length === 0
		) {
			return null;
		}

		const bounds = new Box3();
		bounds.expandByObject(chunkRootContainer);
		const center = bounds.getCenter(new Vector3());
		const size = bounds.getSize(new Vector3());

		return {
			center: { x: center.x, y: center.y, z: center.z },
			size: { x: size.x, y: size.y, z: size.z },
			minimumSpan: 180,
		};
	}

	function reportRenderMetrics(): void {
		const metrics: WorldRenderMetrics = {
			bounds: calculateSceneBoundsFrame(),
			cameraFrame: activeCameraFrame,
			performance: latestPerformanceMetrics,
			portal: latestPortalMetrics,
			debug: latestRenderDebugMetrics,
			geometry: {
				terrainTileCount: terrainScene.tiles.length,
				terrainVertexCount: terrainVertexCount(),
				terrainTriangleCount: terrainTriangleCount(),
				staticRenderablePartCount: staticRenderableScene.parts.length,
				staticRenderableInstancedGroupCount:
					staticRenderableScene.partsByRenderChunkAndGfxAssetId.size,
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
		const metricsKey = JSON.stringify(metrics);
		if (metricsKey === lastReportedMetricsKey) {
			return;
		}

		lastReportedMetricsKey = metricsKey;
		onRenderMetricsChange?.(metrics);
	}

	function terrainVertexCount(): number {
		return terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.vertices.length,
			0,
		);
	}

	function terrainTriangleCount(): number {
		return terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.triangles.length,
			0,
		);
	}

	function shouldUseReducedFrameRate(): boolean {
		return document.visibilityState !== "visible" || !document.hasFocus();
	}

	function syncStaticRenderableMeshes(
		sceneModel: StaticRenderableSceneModel,
	): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const partsByGroupKey = sceneModel.partsByRenderChunkAndGfxAssetId;
		const activeGfxAssetIds = new Set(
			[...partsByGroupKey.values()].flatMap((parts) =>
				parts[0] ? [parts[0].gfxObjAssetId] : [],
			),
		);

		for (const [groupKey, mesh] of staticRenderableGroupMeshes.entries()) {
			const activeParts = partsByGroupKey.get(groupKey);
			if (activeParts && mesh.count === activeParts.length) {
				continue;
			}

			mesh.removeFromParent();
			disposeMeshMaterial(mesh);
			staticRenderableGroupMeshes.delete(groupKey);
		}

		for (const [groupKey, parts] of partsByGroupKey.entries()) {
			const firstPart = parts[0];
			if (!firstPart) {
				continue;
			}
			const gfxAssetId = firstPart.gfxObjAssetId;
			const geometry = getStaticRenderableGeometry(gfxAssetId);
			if (!geometry) {
				continue;
			}

			const chunkRoot = getRenderChunkRoot(firstPart.renderChunk.chunkKey);
			let mesh = staticRenderableGroupMeshes.get(groupKey);
			if (!mesh) {
				mesh = createStaticRenderableInstancedMesh(
					groupKey,
					gfxAssetId,
					geometry,
					parts.length,
				);
				chunkRoot.add(mesh);
				staticRenderableGroupMeshes.set(groupKey, mesh);
			} else {
				chunkRoot.attach(mesh);
			}

			mesh.layers.set(staticRenderableLayerForKind(firstPart.kind));
			if (firstPart.kind === "indoor-static") {
				mesh.layers.enable(WORLD_RENDER_LAYER.portalInterior);
			}
			updateStaticRenderableInstancedMesh(mesh, parts);
		}

		for (const [gfxAssetId, geometry] of staticGeometryCache.entries()) {
			if (activeGfxAssetIds.has(gfxAssetId)) {
				continue;
			}

			geometry.dispose();
			staticGeometryCache.delete(gfxAssetId);
		}

		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function syncDebugOverlayMeshes(sceneModel: WorldDebugOverlayModel): void {
		syncRenderChunkRoots(renderChunkTransforms);

		for (const object of debugOverlayObjects.values()) {
			object.removeFromParent();
			disposeObjectTree(object);
		}
		debugOverlayObjects.clear();

		if (sceneModel.showCellIndicators) {
			for (const cell of sceneModel.cells) {
				const overlay = createCellDebugOverlayGroup(cell);
				getRenderChunkRoot(cell.renderChunk.chunkKey).add(overlay);
				debugOverlayObjects.set(
					debugCellSpatialItemId(cell.renderKey),
					overlay,
				);
			}
		}

		if (sceneModel.showPortalPolygons) {
			for (const portal of sceneModel.portals) {
				const overlay = createPortalDebugOverlayLine(portal);
				if (overlay) {
					getRenderChunkRoot(portal.renderChunk.chunkKey).add(overlay);
					debugOverlayObjects.set(
						portalSpatialItemId(portal.portalId),
						overlay,
					);
				}
			}
		}

		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function syncStructuredInteriorMeshes(
		sceneModel: StructuredInteriorSceneModel,
	): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const activeRenderKeys = new Set(
			sceneModel.cells.map((cell) => cell.renderKey),
		);
		for (const [renderKey, mesh] of structuredInteriorMeshes.entries()) {
			if (activeRenderKeys.has(renderKey)) {
				continue;
			}

			mesh.removeFromParent();
			disposeMesh(mesh);
			structuredInteriorMeshes.delete(renderKey);
		}

		for (const cell of sceneModel.cells) {
			const chunkRoot = getRenderChunkRoot(cell.renderChunk.chunkKey);
			let mesh = structuredInteriorMeshes.get(cell.renderKey);
			if (!mesh) {
				mesh = createStructuredInteriorCellMesh(cell);
				chunkRoot.add(mesh);
				structuredInteriorMeshes.set(cell.renderKey, mesh);
			} else {
				chunkRoot.attach(mesh);
			}

			updateStructuredInteriorCellMesh(mesh, cell);
		}

		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function syncPortalMaskMeshes(model: OutdoorPortalViewGroupModel): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const activeGroupIds = new Set(model.groups.map((group) => group.id));
		for (const [groupId, mesh] of portalMaskMeshes.entries()) {
			if (activeGroupIds.has(groupId)) {
				continue;
			}

			mesh.removeFromParent();
			disposeMesh(mesh);
			portalMaskMeshes.delete(groupId);
		}

		for (const group of model.groups) {
			const chunkRoot = getRenderChunkRoot(group.renderChunk.chunkKey);
			let mesh = portalMaskMeshes.get(group.id);
			if (!mesh) {
				mesh = createPortalMaskMesh(group);
				chunkRoot.add(mesh);
				portalMaskMeshes.set(group.id, mesh);
			} else {
				chunkRoot.attach(mesh);
				updatePortalMaskMesh(mesh, group);
			}
		}

		setPortalMaskVisibility(null);
		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function createStructuredInteriorCellMesh(
		cell: StructuredInteriorCell,
	): Mesh {
		const geometry = buildGfxObjGeometry(cell.renderGeometry);
		const material = new MeshStandardMaterial({
			color: buildStaticRenderableColor(cell.debugColorKey),
			flatShading: true,
			metalness: 0.02,
			roughness: 0.9,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = `structured-interior/${cell.renderKey}`;
		mesh.matrixAutoUpdate = false;
		mesh.layers.set(WORLD_RENDER_LAYER.diagnosticInterior);
		mesh.layers.enable(WORLD_RENDER_LAYER.portalInterior);
		mesh.userData.spatialItemId = structuredCellSpatialItemId(cell.renderKey);
		return mesh;
	}

	function createPortalMaskMesh(group: OutdoorPortalViewGroup): Mesh {
		const mesh = new Mesh(
			buildPortalMaskGeometry(group.aperture.points),
			createPortalMaskMaterial(group.stencilRef),
		);
		mesh.name = `portal-mask/${group.id}`;
		mesh.layers.set(WORLD_RENDER_LAYER.portalMask);
		mesh.matrixAutoUpdate = false;
		updatePortalMaskMesh(mesh, group);
		return mesh;
	}

	function updatePortalMaskMesh(mesh: Mesh, group: OutdoorPortalViewGroup): void {
		mesh.geometry.dispose();
		mesh.geometry = buildPortalMaskGeometry(group.aperture.points);
		mesh.matrix.copy(
			buildAcPlacementMatrix(
				group.aperture.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
		const material = mesh.material;
		if (!Array.isArray(material)) {
			material.stencilRef = group.stencilRef;
		}
	}

	function buildPortalMaskGeometry(
		points: OutdoorPortalViewGroup["aperture"]["points"],
	): BufferGeometry {
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(
				new Float32Array(points.flatMap((point) => [point.x, point.y, point.z])),
				3,
			),
		);
		const indices: number[] = [];
		for (let index = 1; index < points.length - 1; index += 1) {
			indices.push(0, index, index + 1);
		}
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		return geometry;
	}

	function createPortalMaskMaterial(stencilRef: number): MeshBasicMaterial {
		return new MeshBasicMaterial({
			colorWrite: false,
			depthTest: true,
			depthWrite: false,
			side: DoubleSide,
			stencilWrite: true,
			stencilRef,
			stencilFunc: AlwaysStencilFunc,
			stencilFail: KeepStencilOp,
			stencilZFail: KeepStencilOp,
			stencilZPass: ReplaceStencilOp,
		});
	}

	function setPortalMaskVisibility(activeGroupId: string | null): void {
		for (const [groupId, mesh] of portalMaskMeshes.entries()) {
			mesh.visible = activeGroupId !== null && groupId === activeGroupId;
		}
	}

	function setPortalInteriorVisibility(group: OutdoorPortalViewGroup): void {
		const visibleEnvCellIds = new Set(group.requestedInteriorEnvCellIds);
		for (const [renderKey, mesh] of structuredInteriorMeshes.entries()) {
			const cell = structuredInteriorScene.cells.find(
				(entry) => entry.renderKey === renderKey,
			);
			mesh.visible = cell ? visibleEnvCellIds.has(cell.envCellId) : false;
		}
		for (const [groupKey, mesh] of staticRenderableGroupMeshes.entries()) {
			const parts = staticRenderableScene.partsByRenderChunkAndGfxAssetId.get(
				groupKey,
			);
			if (!parts?.[0] || parts[0].kind !== "indoor-static") {
				continue;
			}
			mesh.visible = parts.some(
				(part) =>
					part.owningEnvCellId !== null &&
					visibleEnvCellIds.has(part.owningEnvCellId),
			);
		}
	}

	function restorePortalInteriorVisibility(): void {
		for (const mesh of structuredInteriorMeshes.values()) {
			mesh.visible = true;
		}
		for (const [groupKey, mesh] of staticRenderableGroupMeshes.entries()) {
			const parts = staticRenderableScene.partsByRenderChunkAndGfxAssetId.get(
				groupKey,
			);
			if (parts?.[0]?.kind === "indoor-static") {
				mesh.visible = true;
			}
		}
	}

	function applyPortalInteriorStencil(stencilRef: number): void {
		forEachPortalInteriorMaterial((material) => {
			material.stencilWrite = true;
			material.stencilRef = stencilRef;
			material.stencilFunc = EqualStencilFunc;
			material.stencilFail = KeepStencilOp;
			material.stencilZFail = KeepStencilOp;
			material.stencilZPass = KeepStencilOp;
		});
	}

	function clearPortalInteriorStencil(): void {
		forEachPortalInteriorMaterial((material) => {
			material.stencilWrite = false;
			material.stencilRef = 0;
			material.stencilFunc = AlwaysStencilFunc;
			material.stencilFail = KeepStencilOp;
			material.stencilZFail = KeepStencilOp;
			material.stencilZPass = KeepStencilOp;
		});
	}

	function forEachPortalInteriorMaterial(
		visit: (material: Material) => void,
	): void {
		for (const mesh of structuredInteriorMeshes.values()) {
			visitMeshMaterials(mesh, visit);
		}
		for (const [groupKey, mesh] of staticRenderableGroupMeshes.entries()) {
			const parts = staticRenderableScene.partsByRenderChunkAndGfxAssetId.get(
				groupKey,
			);
			if (parts?.[0]?.kind === "indoor-static") {
				visitMeshMaterials(mesh, visit);
			}
		}
	}

	function visitMeshMaterials(
		mesh: Mesh | InstancedMesh,
		visit: (material: Material) => void,
	): void {
		if (Array.isArray(mesh.material)) {
			for (const material of mesh.material) {
				visit(material);
			}
			return;
		}

		visit(mesh.material);
	}

	function createCellDebugOverlayGroup(cell: CellDebugOverlay): Group {
		const group = new Group();
		group.name = `debug-cell/${cell.renderKey}`;
		group.matrixAutoUpdate = false;
		group.layers.set(WORLD_RENDER_LAYER.debugOverlay);
		group.matrix.copy(
			buildAcPlacementMatrix(
				cell.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{
					x: 1,
					y: 1,
					z: 1,
				},
			),
		);

		const color = buildStaticRenderableColor(cell.colorKey);
		const bounds = cell.bounds
			? createBoundsLineSegments(
					cell.bounds,
					cell.isSelected ? new Color("#ffffff") : color,
				)
			: null;
		if (bounds) {
			bounds.name = `debug-cell-bounds/${cell.renderKey}`;
			group.add(bounds);
		}
		if (cell.isSelected && cell.bounds) {
			const selectedBounds = createThickBoundsLineGroup(
				cell.bounds,
				new Color("#ffffff"),
				SELECTED_DEBUG_EDGE_RADIUS,
			);
			selectedBounds.name = `debug-cell-selected-bounds/${cell.renderKey}`;
			group.add(selectedBounds);
		}

		setObjectTreeLayer(group, WORLD_RENDER_LAYER.debugOverlay);
		return group;
	}

	function createPortalDebugOverlayLine(
		portal: PortalDebugOverlay,
	): Object3D | null {
		if (portal.points.length < 3) {
			return null;
		}

		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(
				new Float32Array(
					portal.points.flatMap((point) => [point.x, point.y, point.z]),
				),
				3,
			),
		);
		const line = new LineLoop(
			geometry,
			new LineBasicMaterial({
				color: buildPortalOverlayColor(portal),
				depthWrite: false,
				transparent: true,
				opacity: 0.95,
			}),
		);
		line.name = `debug-portal/${portal.portalId}`;
		line.layers.set(WORLD_RENDER_LAYER.debugOverlay);
		if (!portal.isSelected) {
			line.matrixAutoUpdate = false;
			line.matrix.copy(
				buildAcPlacementMatrix(
					portal.chunkLocalPlacement,
					{ x: 0, y: 0, z: 0 },
					{
						x: 1,
						y: 1,
						z: 1,
					},
				),
			);
			return line;
		}

		const group = new Group();
		group.name = `debug-portal-selected/${portal.portalId}`;
		group.matrixAutoUpdate = false;
		group.layers.set(WORLD_RENDER_LAYER.debugOverlay);
		group.matrix.copy(
			buildAcPlacementMatrix(
				portal.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{
					x: 1,
					y: 1,
					z: 1,
				},
			),
		);
		group.add(line);
		group.add(
			createThickPolylineGroup(
				portal.points,
				true,
				new Color("#ffffff"),
				SELECTED_DEBUG_EDGE_RADIUS,
			),
		);
		setObjectTreeLayer(group, WORLD_RENDER_LAYER.debugOverlay);
		return group;
	}

	function createBoundsLineSegments(
		bounds: NonNullable<CellDebugOverlay["bounds"]>,
		color: Color,
	): LineSegments {
		const { min, max } = bounds;
		const corners = [
			[min.x, min.y, min.z],
			[max.x, min.y, min.z],
			[max.x, max.y, min.z],
			[min.x, max.y, min.z],
			[min.x, min.y, max.z],
			[max.x, min.y, max.z],
			[max.x, max.y, max.z],
			[min.x, max.y, max.z],
		];
		const edgeIndices = [
			0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
		];
		const positions = edgeIndices.flatMap((index) => corners[index] ?? []);
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(new Float32Array(positions), 3),
		);
		return new LineSegments(
			geometry,
			new LineBasicMaterial({
				color,
				depthTest: false,
				depthWrite: false,
				transparent: true,
				opacity: 0.32,
			}),
		);
	}

	function createThickBoundsLineGroup(
		bounds: NonNullable<CellDebugOverlay["bounds"]>,
		color: Color,
		radius: number,
	): Group {
		const { min, max } = bounds;
		const corners = [
			new Vector3(min.x, min.y, min.z),
			new Vector3(max.x, min.y, min.z),
			new Vector3(max.x, max.y, min.z),
			new Vector3(min.x, max.y, min.z),
			new Vector3(min.x, min.y, max.z),
			new Vector3(max.x, min.y, max.z),
			new Vector3(max.x, max.y, max.z),
			new Vector3(min.x, max.y, max.z),
		];
		const edgeIndices = [
			0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
		];
		const group = new Group();
		const material = createSelectedDebugEdgeMaterial(color);
		for (let index = 0; index < edgeIndices.length; index += 2) {
			const start = corners[edgeIndices[index] ?? 0];
			const end = corners[edgeIndices[index + 1] ?? 0];
			if (start && end) {
				group.add(createCylinderSegment(start, end, radius, material));
			}
		}
		return group;
	}

	function createThickPolylineGroup(
		points: PortalDebugOverlay["points"],
		closed: boolean,
		color: Color,
		radius: number,
	): Group {
		const group = new Group();
		const material = createSelectedDebugEdgeMaterial(color);
		const vectors = points.map(
			(point) => new Vector3(point.x, point.y, point.z),
		);
		const segmentCount = closed ? vectors.length : vectors.length - 1;
		for (let index = 0; index < segmentCount; index += 1) {
			const start = vectors[index];
			const end = vectors[(index + 1) % vectors.length];
			if (start && end) {
				group.add(createCylinderSegment(start, end, radius, material));
			}
		}
		return group;
	}

	function createSelectedDebugEdgeMaterial(color: Color): MeshBasicMaterial {
		return new MeshBasicMaterial({
			color,
			depthTest: false,
			depthWrite: false,
			transparent: true,
			opacity: 0.95,
		});
	}

	function createCylinderSegment(
		start: Vector3,
		end: Vector3,
		radius: number,
		material: MeshBasicMaterial,
	): Mesh {
		const direction = new Vector3().subVectors(end, start);
		const length = direction.length();
		const mesh = new Mesh(
			new CylinderGeometry(radius, radius, length, 8),
			material,
		);
		mesh.position.copy(start).add(end).multiplyScalar(0.5);
		if (length > 0) {
			mesh.quaternion.setFromUnitVectors(
				new Vector3(0, 1, 0),
				direction.normalize(),
			);
		}
		return mesh;
	}

	function buildPortalOverlayColor(portal: PortalDebugOverlay): Color {
		if (portal.isSelected) {
			return new Color("#ffffff");
		}
		if (debugOverlayScene.highlightPortalTargets) {
			if (portal.targetStatus === "loaded-visible") {
				return new Color("#61d394");
			}
			if (portal.targetStatus === "known-unloaded") {
				return new Color("#f4d35e");
			}
			if (portal.targetStatus === "outside") {
				return new Color("#7cc7ff");
			}
			if (portal.targetStatus === "missing-polygon") {
				return new Color("#ff6b6b");
			}
			return new Color("#9aa9b2");
		}

		return buildStaticRenderableColor(portal.colorKey);
	}

	function updateStructuredInteriorCellMesh(
		mesh: Mesh,
		cell: StructuredInteriorCell,
	): void {
		mesh.matrix.copy(
			buildAcPlacementMatrix(
				cell.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{
					x: 1,
					y: 1,
					z: 1,
				},
			),
		);
		mesh.matrixWorldNeedsUpdate = true;
	}

	function getStaticRenderableGeometry(
		gfxAssetId: string,
	): BufferGeometry | null {
		const cachedGeometry = staticGeometryCache.get(gfxAssetId);
		if (cachedGeometry) {
			return cachedGeometry;
		}

		const asset = assetState.preparedByAssetId[gfxAssetId];
		if (
			!isPreparedGfxObjAsset(asset) ||
			asset.payload.renderGeometry.vertexCount === 0
		) {
			return null;
		}

		const geometry = buildGfxObjGeometry(asset.payload.renderGeometry);
		staticGeometryCache.set(gfxAssetId, geometry);
		return geometry;
	}

	function createStaticRenderableInstancedMesh(
		groupKey: string,
		gfxAssetId: string,
		geometry: BufferGeometry,
		count: number,
	): InstancedMesh {
		const material = new MeshStandardMaterial({
			color: "#ffffff",
			flatShading: true,
			metalness: 0.02,
			roughness: 0.88,
		});
		const mesh = new InstancedMesh(geometry, material, count);
		mesh.name = `static-renderable/${groupKey}`;
		mesh.userData.gfxAssetId = gfxAssetId;
		return mesh;
	}

	function updateStaticRenderableInstancedMesh(
		mesh: InstancedMesh,
		parts: StaticRenderablePart[],
	): void {
		parts.forEach((part, index) => {
			mesh.setMatrixAt(index, buildStaticRenderablePartMatrix(part));
			mesh.setColorAt(index, buildStaticRenderableColor(part.debugColorKey));
		});
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) {
			mesh.instanceColor.needsUpdate = true;
		}
	}

	function createTerrainTileMesh(tile: TerrainSceneTile): Mesh {
		const geometry = buildTerrainGeometry(tile.mesh);
		const material = new MeshStandardMaterial({
			vertexColors: true,
			flatShading: true,
			metalness: 0.05,
			roughness: 0.94,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = tile.assetId;
		return mesh;
	}

	function dispose(): void {
		if (disposed) {
			return;
		}
		disposed = true;
		window.cancelAnimationFrame(frameId);
		window.removeEventListener("focus", syncReducedFrameRateState);
		window.removeEventListener("blur", syncReducedFrameRateState);
		document.removeEventListener("visibilitychange", syncReducedFrameRateState);
		resizeObserver.disconnect();
		for (const mesh of terrainMeshes.values()) {
			disposeMesh(mesh);
		}
		terrainMeshes.clear();
		for (const mesh of staticRenderableGroupMeshes.values()) {
			disposeMeshMaterial(mesh);
		}
		staticRenderableGroupMeshes.clear();
		for (const geometry of staticGeometryCache.values()) {
			geometry.dispose();
		}
		staticGeometryCache.clear();
		for (const mesh of structuredInteriorMeshes.values()) {
			disposeMesh(mesh);
		}
		structuredInteriorMeshes.clear();
		for (const mesh of portalMaskMeshes.values()) {
			disposeMesh(mesh);
		}
		portalMaskMeshes.clear();
		for (const object of debugOverlayObjects.values()) {
			disposeObjectTree(object);
		}
		debugOverlayObjects.clear();
		chunkRoots.clear();
		chunkRootContainer.clear();
		renderer.dispose();
		renderer.domElement.remove();
	}
}

function disposeMesh(mesh: Mesh): void {
	mesh.geometry.dispose();
	disposeMeshMaterial(mesh);
}

function disposeObjectTree(root: Object3D): void {
	root.traverse((object) => {
		const maybeGeometry = (object as { geometry?: unknown }).geometry;
		if (maybeGeometry instanceof BufferGeometry) {
			maybeGeometry.dispose();
		}

		const maybeMaterial = (object as { material?: unknown }).material;
		if (Array.isArray(maybeMaterial)) {
			for (const material of maybeMaterial) {
				disposeMaterial(material);
			}
			return;
		}
		if (maybeMaterial) {
			disposeMaterial(maybeMaterial as Material);
		}
	});
}

function disposeMaterial(material: Material): void {
	material.dispose();
}

function enableAllWorldRenderLayers(object: Object3D): void {
	for (const layer of Object.values(WORLD_RENDER_LAYER)) {
		object.layers.enable(layer);
	}
}

function setObjectTreeLayer(root: Object3D, layer: number): void {
	root.traverse((object) => object.layers.set(layer));
}

function countVisibleObjects(objects: Iterable<Object3D>): number {
	let count = 0;
	for (const object of objects) {
		if (object.visible) {
			count += 1;
		}
	}
	return count;
}

function createPortalRenderMetrics(
	model: OutdoorPortalViewGroupModel,
): WorldRenderPortalMetrics {
	return {
		candidateOutdoorPortalCount: model.diagnostics.topologyPortalCount,
		visiblePortalGroupCount: 0,
		maskedInteriorCellCount: 0,
		skippedMissingApertureCount:
			model.diagnostics.skippedMissingApertureCount,
		skippedMissingPolygonCount:
			model.diagnostics.skippedMissingPolygonCount,
		skippedOutsideFrustumCount: 0,
		skippedBackFacingCount: 0,
		skippedTooSmallCount: 0,
	};
}

function createRenderDebugMetrics(
	renderer: WebGLRenderer,
	options: Omit<
		WorldRenderDebugMetrics,
		| "canvasWidth"
		| "canvasHeight"
		| "pixelRatio"
		| "renderCalls"
		| "renderTriangles"
		| "renderLines"
		| "renderPoints"
	>,
): WorldRenderDebugMetrics {
	return {
		canvasWidth: renderer.domElement.width,
		canvasHeight: renderer.domElement.height,
		pixelRatio: renderer.getPixelRatio(),
		renderPassCount: options.renderPassCount,
		portalGroupCount: options.portalGroupCount,
		portalMaskMeshCount: options.portalMaskMeshCount,
		terrainMeshCount: options.terrainMeshCount,
		visibleTerrainMeshCount: options.visibleTerrainMeshCount,
		staticGroupMeshCount: options.staticGroupMeshCount,
		visibleStaticGroupMeshCount: options.visibleStaticGroupMeshCount,
		structuredInteriorMeshCount: options.structuredInteriorMeshCount,
		visibleStructuredInteriorMeshCount:
			options.visibleStructuredInteriorMeshCount,
		debugOverlayObjectCount: options.debugOverlayObjectCount,
		visibleDebugOverlayObjectCount: options.visibleDebugOverlayObjectCount,
		renderCalls: renderer.info.render.calls,
		renderTriangles: renderer.info.render.triangles,
		renderLines: renderer.info.render.lines,
		renderPoints: renderer.info.render.points,
	};
}

function disposeMeshMaterial(mesh: Mesh): void {
	const material = mesh.material;
	if (Array.isArray(material)) {
		for (const entry of material) {
			entry.dispose();
		}
		return;
	}

	material.dispose();
}
