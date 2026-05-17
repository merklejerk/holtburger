<script lang="ts">
	import { untrack } from "svelte";
	import {
		AmbientLight,
		Box3,
		BufferGeometry,
		BufferAttribute,
		Color,
		CylinderGeometry,
		DirectionalLight,
		Frustum,
		Group,
		InstancedMesh,
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
		Scene,
		Vector2,
		Vector3,
		WebGLRenderer,
	} from "three";

	import type { AssetChannelState } from "../assets/types";
	import {
		type StaticRenderablePart,
		type StaticRenderableSceneModel,
		isPreparedGfxObjAsset,
	} from "./static-renderables";
	import { type NormalizedViewportPoint } from "./model";
	import {
		type TerrainSceneModel,
		type TerrainSceneTile,
	} from "./terrain-scene";
	import type {
		CellDebugOverlay,
		PortalDebugOverlay,
		WorldDebugOverlayModel,
	} from "./debug-overlays";
	import { buildTerrainGeometry } from "./terrain-geometry";
	import {
		buildGfxObjGeometry,
		buildAcPlacementMatrix,
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
		type SceneCameraFrame,
		type SceneBoundsFrame,
	} from "./camera";
	import type {
		WorldRenderCameraFrameChangeHandler,
		WorldRenderMetrics,
		WorldRenderMetricsChangeHandler,
	} from "./renderer-contract";
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
	import type { RenderChunkKey, RenderLandblockAnchor } from "./render-chunks";
	import {
		syncRenderChunkRootRecords,
		type RenderChunkRootRecord,
	} from "./chunk-root-manager";

	let {
		assetState,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		debugOverlayScene,
		activeRenderAnchor = null,
		renderChunkTransforms = [],
		renderSpatialQuery = null,
		controlledCameraFrame = null,
		onCameraFrameChange,
		onRenderMetricsChange,
	}: {
		assetState: AssetChannelState;
		terrainScene: TerrainSceneModel;
		staticRenderableScene: StaticRenderableSceneModel;
		structuredInteriorScene: StructuredInteriorSceneModel;
		debugOverlayScene: WorldDebugOverlayModel;
		activeRenderAnchor?: RenderLandblockAnchor | null;
		renderChunkTransforms?: RenderChunkTransform[];
		renderSpatialQuery?: RenderSpatialIndexQuery | null;
		controlledCameraFrame?: SceneCameraFrame | null;
		onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
		onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
	} = $props();
	let viewportHost = $state<HTMLDivElement | null>(null);
	let renderer: WebGLRenderer | null = null;
	let scene: Scene | null = null;
	let camera: PerspectiveCamera | null = null;
	let chunkRootContainer: Group | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let activeCameraFrame = $state<SceneCameraFrame | null>(null);
	const terrainMeshes = new Map<string, Mesh>();
	const staticGeometryCache = new Map<string, BufferGeometry>();
	const staticRenderableGroupMeshes = new Map<string, InstancedMesh>();
	const structuredInteriorMeshes = new Map<string, Mesh>();
	const debugOverlayObjects = new Map<string, Object3D>();
	const chunkRoots = new Map<RenderChunkKey, RenderChunkRootRecord<Group>>();
	let lastReportedMetricsKey: string | null = null;
	let latestPerformanceMetrics: WorldRenderMetrics["performance"] = null;
	let isSpatialVisibilityDirty = true;

	const PERFORMANCE_REPORT_INTERVAL_MS = 500;
	const UNFOCUSED_MAX_RENDER_FPS = 15;
	const UNFOCUSED_RENDER_INTERVAL_MS = 1000 / UNFOCUSED_MAX_RENDER_FPS;
	const SELECTED_DEBUG_EDGE_RADIUS = 0.12;

	const terrainVertexCount = $derived(
		terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.vertices.length,
			0,
		),
	);
	const terrainTriangleCount = $derived(
		terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.triangles.length,
			0,
		),
	);
	$effect(() => {
		if (!viewportHost) {
			return;
		}

		const host = viewportHost;
		const nextRenderer = new WebGLRenderer({ antialias: true, alpha: true });
		nextRenderer.setPixelRatio(window.devicePixelRatio);
		nextRenderer.outputColorSpace = "srgb";
		nextRenderer.domElement.className = "world-display__three-canvas";
		host.append(nextRenderer.domElement);

		const nextScene = new Scene();
		nextScene.background = new Color("#0e1a24");

		const nextCamera = new PerspectiveCamera(52, 1, 0.1, 5000);

		const ambientLight = new AmbientLight("#d7e9f9", 1.4);
		const sunLight = new DirectionalLight("#fff1d6", 2.1);
		sunLight.position.set(220, 320, 160);
		nextScene.add(ambientLight, sunLight);

		const nextChunkRootContainer = new Group();
		nextChunkRootContainer.name = "render-chunk-roots";
		nextScene.add(nextChunkRootContainer);

		renderer = nextRenderer;
		scene = nextScene;
		camera = nextCamera;
		chunkRootContainer = nextChunkRootContainer;

		const nextResizeObserver = new ResizeObserver(() => {
			syncRendererSize();
			updateCameraFrame();
		});
		nextResizeObserver.observe(host);
		resizeObserver = nextResizeObserver;

		syncRendererSize();
		untrack(() => syncSceneContent());

		let frameId = 0;
		let lastFrameAt: number | null = null;
		let lastRenderedAt: number | null = null;
		let performanceWindowStartedAt = 0;
		let performanceWindowFrameCount = 0;
		let performanceWindowFrameMs = 0;
		let performanceWindowRenderMs = 0;
		let isReducedFrameRateActive = shouldUseReducedFrameRate();

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

		window.addEventListener("focus", syncReducedFrameRateState);
		window.addEventListener("blur", syncReducedFrameRateState);
		document.addEventListener("visibilitychange", syncReducedFrameRateState);

		const renderFrame = (frameAt: number) => {
			frameId = window.requestAnimationFrame(renderFrame);
			if (
				renderer === nextRenderer &&
				scene === nextScene &&
				camera === nextCamera
			) {
				if (isSpatialVisibilityDirty) {
					syncSpatialVisibility();
				}
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
				nextRenderer.render(nextScene, nextCamera);
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
		};
		frameId = window.requestAnimationFrame(renderFrame);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.removeEventListener("focus", syncReducedFrameRateState);
			window.removeEventListener("blur", syncReducedFrameRateState);
			document.removeEventListener(
				"visibilitychange",
				syncReducedFrameRateState,
			);
			nextResizeObserver.disconnect();
			if (resizeObserver === nextResizeObserver) {
				resizeObserver = null;
			}
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
			for (const object of debugOverlayObjects.values()) {
				disposeObjectTree(object);
			}
			debugOverlayObjects.clear();
			chunkRoots.clear();
			nextChunkRootContainer.clear();
			nextRenderer.dispose();
			nextRenderer.domElement.remove();
			if (renderer === nextRenderer) {
				renderer = null;
			}
			if (scene === nextScene) {
				scene = null;
			}
			if (camera === nextCamera) {
				camera = null;
			}
			if (chunkRootContainer === nextChunkRootContainer) {
				chunkRootContainer = null;
			}
		};
	});

	$effect(() => {
		const transforms = renderChunkTransforms;
		untrack(() => syncRenderChunkRoots(transforms));
	});

	$effect(() => {
		const sceneModel = terrainScene;
		untrack(() => syncTerrainMeshes(sceneModel));
	});

	$effect(() => {
		const sceneModel = staticRenderableScene;
		untrack(() => syncStaticRenderableMeshes(sceneModel));
	});

	$effect(() => {
		const sceneModel = structuredInteriorScene;
		untrack(() => syncStructuredInteriorMeshes(sceneModel));
	});

	$effect(() => {
		const sceneModel = debugOverlayScene;
		untrack(() => syncDebugOverlayMeshes(sceneModel));
	});

	$effect(() => {
		if (!controlledCameraFrame) {
			return;
		}

		setActiveCameraFrame(resolveControlledCameraFrame(controlledCameraFrame), {
			notifyParent: false,
		});
		reportRenderMetrics();
	});

	$effect(() => {
		renderSpatialQuery;
		markSpatialVisibilityDirty();
	});

	export function pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null {
		const pick = pickAtViewportPoint(viewportPoint, new Set(["terrain"]));
		return pick?.item.metadata.kind === "terrain"
			? pick.item.metadata.landblockId
			: null;
	}

	export function pickAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null {
		if (!camera || !renderSpatialQuery) {
			return null;
		}
		const ray = buildViewportRay(viewportPoint);
		return renderSpatialQuery.pickRay(ray, mask, ownerKeys);
	}

	function syncRendererSize(): void {
		if (!renderer || !camera || !viewportHost) {
			return;
		}

		const width = Math.max(viewportHost.clientWidth, 1);
		const height = Math.max(viewportHost.clientHeight, 1);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	function syncSceneContent(): void {
		syncRenderChunkRoots(renderChunkTransforms);
		syncTerrainMeshes(terrainScene);
		syncStaticRenderableMeshes(staticRenderableScene);
		syncStructuredInteriorMeshes(structuredInteriorScene);
		syncDebugOverlayMeshes(debugOverlayScene);
	}

	function syncRenderChunkRoots(
		transforms: readonly RenderChunkTransform[],
	): void {
		if (!chunkRootContainer) {
			return;
		}

		syncRenderChunkRootRecords(chunkRoots, transforms, {
			createRoot: createRenderChunkRoot,
			updateRootPosition: updateRenderChunkRootPosition,
			canDisposeRoot: (root) => root.children.length === 0,
			disposeRoot: disposeRenderChunkRoot,
		});
		untrack(() => {
			updateCameraFrame();
			reportRenderMetrics();
			markSpatialVisibilityDirty();
		});
	}

	function createRenderChunkRoot(transform: RenderChunkTransform): Group {
		if (!chunkRootContainer) {
			throw new Error("Cannot create a render chunk root before scene setup.");
		}

		const root = new Group();
		root.name = `render-chunk/${transform.chunkKey}`;
		root.userData.chunkKey = transform.chunkKey;
		root.userData.chunkLandblockId = transform.chunkLandblockId;
		chunkRootContainer.add(root);
		return root;
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
		const aspect = camera?.aspect ?? frame.aspect;
		if (frame.aspect === aspect) {
			return frame;
		}
		return { ...frame, aspect };
	}

	function syncTerrainMeshes(sceneModel: TerrainSceneModel): void {
		if (!chunkRootContainer) {
			return;
		}

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
			chunkRoot.add(mesh);
			terrainMeshes.set(tile.assetId, mesh);
		}
		untrack(() => {
			updateCameraFrame();
			markSpatialVisibilityDirty();
		});
	}

	function buildViewportRay(viewportPoint: NormalizedViewportPoint): {
		origin: { x: number; y: number; z: number };
		direction: { x: number; y: number; z: number };
	} {
		if (!camera) {
			throw new Error("Cannot build a viewport ray without an active camera.");
		}
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
		isSpatialVisibilityDirty = false;
		if (!camera || !renderSpatialQuery) {
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
		if (!camera) {
			throw new Error(
				"Cannot build a render frustum without an active camera.",
			);
		}
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
		if (!camera) {
			return;
		}

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
		const aspect = camera?.aspect ?? 1;
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
		markSpatialVisibilityDirty();
		if (options.notifyParent) {
			onCameraFrameChange?.(frame);
		}
	}

	function applySceneCameraFrame(frame: SceneCameraFrame): void {
		if (!camera) {
			return;
		}

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
		if (!chunkRootContainer) {
			return null;
		}

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
			geometry: {
				terrainTileCount: terrainScene.tiles.length,
				terrainVertexCount,
				terrainTriangleCount,
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

	function shouldUseReducedFrameRate(): boolean {
		return document.visibilityState !== "visible" || !document.hasFocus();
	}

	function syncStaticRenderableMeshes(
		sceneModel: StaticRenderableSceneModel,
	): void {
		if (!chunkRootContainer) {
			return;
		}

		const partsByGroupKey = sceneModel.partsByRenderChunkAndGfxAssetId;
		const activeGroupKeys = new Set(partsByGroupKey.keys());
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

			updateStaticRenderableInstancedMesh(mesh, parts);
		}

		for (const [gfxAssetId, geometry] of staticGeometryCache.entries()) {
			if (activeGfxAssetIds.has(gfxAssetId)) {
				continue;
			}

			geometry.dispose();
			staticGeometryCache.delete(gfxAssetId);
		}

		untrack(() => {
			updateCameraFrame();
			markSpatialVisibilityDirty();
		});
	}

	function syncDebugOverlayMeshes(sceneModel: WorldDebugOverlayModel): void {
		if (!chunkRootContainer) {
			return;
		}

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

		untrack(() => {
			updateCameraFrame();
			markSpatialVisibilityDirty();
		});
	}

	function syncStructuredInteriorMeshes(
		sceneModel: StructuredInteriorSceneModel,
	): void {
		if (!chunkRootContainer) {
			return;
		}

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

		untrack(() => {
			updateCameraFrame();
			markSpatialVisibilityDirty();
		});
	}

	function markSpatialVisibilityDirty(): void {
		isSpatialVisibilityDirty = true;
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
			transparent: !cell.isFocus,
			opacity: cell.isFocus ? 1 : 0.74,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = `structured-interior/${cell.renderKey}`;
		mesh.matrixAutoUpdate = false;
		mesh.userData.spatialItemId = structuredCellSpatialItemId(cell.renderKey);
		return mesh;
	}

	function createCellDebugOverlayGroup(cell: CellDebugOverlay): Group {
		const group = new Group();
		group.name = `debug-cell/${cell.renderKey}`;
		group.matrixAutoUpdate = false;
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
</script>

<div class="world-display">
	<button
		aria-label="World display viewport"
		class="world-display__viewport-button"
		type="button"
	>
		<div class="world-display__viewport">
			<div bind:this={viewportHost} class="world-display__three-host"></div>
		</div>
	</button>
</div>
