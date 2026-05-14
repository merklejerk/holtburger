<script lang="ts">
	import { untrack } from "svelte";
	import {
		AmbientLight,
		Box3,
		BufferGeometry,
		Color,
		DirectionalLight,
		Group,
		InstancedMesh,
		Mesh,
		MeshStandardMaterial,
		PerspectiveCamera,
		Raycaster,
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
		buildDebugOrbitCameraFrame,
		createDebugOrbitCameraState,
		fitDebugOrbitCameraToBounds,
		type DebugOrbitCameraState,
		type SceneCameraFrame,
		type SceneBoundsFrame,
	} from "./camera";
	import type {
		WorldRenderCameraFrameChangeHandler,
		WorldRenderMetrics,
		WorldRenderMetricsChangeHandler,
	} from "./renderer-contract";

	let {
		assetState,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		controlledCameraFrame = null,
		onCameraFrameChange,
		onRenderMetricsChange,
	}: {
		assetState: AssetChannelState;
		terrainScene: TerrainSceneModel;
		staticRenderableScene: StaticRenderableSceneModel;
		structuredInteriorScene: StructuredInteriorSceneModel;
		controlledCameraFrame?: SceneCameraFrame | null;
		onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
		onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
	} = $props();
	let viewportHost = $state<HTMLDivElement | null>(null);
	let renderer: WebGLRenderer | null = null;
	let scene: Scene | null = null;
	let camera: PerspectiveCamera | null = null;
	let terrainRoot: Group | null = null;
	let staticRenderableRoot: Group | null = null;
	let structuredInteriorRoot: Group | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let debugCameraState = $state<DebugOrbitCameraState>(
		createDebugOrbitCameraState(),
	);
	let activeCameraFrame = $state<SceneCameraFrame | null>(null);
	const terrainMeshes = new Map<string, Mesh>();
	const staticGeometryCache = new Map<string, BufferGeometry>();
	const staticRenderableMeshes = new Map<string, InstancedMesh>();
	const structuredInteriorMeshes = new Map<string, Mesh>();
	const terrainRaycaster = new Raycaster();
	let lastReportedMetricsKey: string | null = null;

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

		const nextTerrainRoot = new Group();
		const nextStaticRenderableRoot = new Group();
		const nextStructuredInteriorRoot = new Group();
		nextScene.add(nextTerrainRoot);
		nextScene.add(nextStaticRenderableRoot);
		nextScene.add(nextStructuredInteriorRoot);

		renderer = nextRenderer;
		scene = nextScene;
		camera = nextCamera;
		terrainRoot = nextTerrainRoot;
		staticRenderableRoot = nextStaticRenderableRoot;
		structuredInteriorRoot = nextStructuredInteriorRoot;

		const nextResizeObserver = new ResizeObserver(() => {
			syncRendererSize();
			updateCameraFrame();
		});
		nextResizeObserver.observe(host);
		resizeObserver = nextResizeObserver;

		syncRendererSize();

		let frameId = 0;
		const renderFrame = () => {
			frameId = window.requestAnimationFrame(renderFrame);
			if (
				renderer === nextRenderer &&
				scene === nextScene &&
				camera === nextCamera
			) {
				nextRenderer.render(nextScene, nextCamera);
			}
		};
		renderFrame();

		return () => {
			window.cancelAnimationFrame(frameId);
			nextResizeObserver.disconnect();
			if (resizeObserver === nextResizeObserver) {
				resizeObserver = null;
			}
			for (const mesh of terrainMeshes.values()) {
				disposeMesh(mesh);
			}
			terrainMeshes.clear();
			for (const mesh of staticRenderableMeshes.values()) {
				disposeMeshMaterial(mesh);
			}
			staticRenderableMeshes.clear();
			for (const geometry of staticGeometryCache.values()) {
				geometry.dispose();
			}
			staticGeometryCache.clear();
			for (const mesh of structuredInteriorMeshes.values()) {
				disposeMesh(mesh);
			}
			structuredInteriorMeshes.clear();
			nextTerrainRoot.clear();
			nextStaticRenderableRoot.clear();
			nextStructuredInteriorRoot.clear();
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
			if (terrainRoot === nextTerrainRoot) {
				terrainRoot = null;
			}
			if (staticRenderableRoot === nextStaticRenderableRoot) {
				staticRenderableRoot = null;
			}
			if (structuredInteriorRoot === nextStructuredInteriorRoot) {
				structuredInteriorRoot = null;
			}
		};
	});

	$effect(() => {
		syncTerrainMeshes();
	});

	$effect(() => {
		syncStaticRenderableMeshes();
	});

	$effect(() => {
		syncStructuredInteriorMeshes();
	});

	$effect(() => {
		if (!controlledCameraFrame) {
			return;
		}

		setActiveCameraFrame(controlledCameraFrame, { notifyParent: false });
		reportRenderMetrics();
	});

	export function pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null {
		return pickTerrainLandblock(viewportPoint);
	}

	function pickTerrainLandblock(
		viewportPoint: NormalizedViewportPoint,
	): number | null {
		if (!camera || terrainMeshes.size === 0) {
			return null;
		}

		terrainRaycaster.setFromCamera(
			new Vector2(
				viewportPoint.normalizedX * 2 - 1,
				-(viewportPoint.normalizedY * 2 - 1),
			),
			camera,
		);
		const intersections = terrainRaycaster.intersectObjects(
			[...terrainMeshes.values()],
			false,
		);
		const pickedMesh = intersections[0]?.object;
		const landblockId = pickedMesh?.userData.landblockId;

		return typeof landblockId === "number" ? landblockId : null;
	}

	function syncRendererSize(): void {
		if (!renderer || !camera || !viewportHost) {
			return;
		}

		const width = Math.max(viewportHost.clientWidth, 1);
		const height = Math.max(viewportHost.clientHeight, 1);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	function syncTerrainMeshes(): void {
		if (!terrainRoot) {
			return;
		}

		const activeAssetIds = new Set(
			terrainScene.tiles.map((tile) => tile.assetId),
		);
		for (const [assetId, mesh] of terrainMeshes.entries()) {
			if (activeAssetIds.has(assetId)) {
				continue;
			}

			terrainRoot.remove(mesh);
			disposeMesh(mesh);
			terrainMeshes.delete(assetId);
		}

		for (const tile of terrainScene.tiles) {
			const existing = terrainMeshes.get(tile.assetId);
			if (existing) {
				existing.position.set(tile.worldOffsetX, 0, -tile.worldOffsetY);
				continue;
			}

			const mesh = createTerrainTileMesh(tile);
			mesh.position.set(tile.worldOffsetX, 0, -tile.worldOffsetY);
			mesh.userData.landblockId = tile.landblockId;
			terrainRoot.add(mesh);
			terrainMeshes.set(tile.assetId, mesh);
		}

		untrack(() => updateCameraFrame());
	}

	function updateCameraFrame(forceFit = false): void {
		if (
			!camera ||
			!terrainRoot ||
			!staticRenderableRoot ||
			!structuredInteriorRoot
		) {
			return;
		}

		if (
			terrainScene.tiles.length === 0 &&
			staticRenderableScene.parts.length === 0 &&
			structuredInteriorScene.cells.length === 0
		) {
			const fallbackFrame: SceneCameraFrame = {
				position: { x: 180, y: 220, z: 180 },
				target: { x: 0, y: 0, z: 0 },
				up: { x: 0, y: 1, z: 0 },
				aspect: camera.aspect,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			};
			setActiveCameraFrame(fallbackFrame, { notifyParent: true });
			reportRenderMetrics();
			return;
		}

		const boundsFrame = calculateSceneBoundsFrame();
		if (!boundsFrame) {
			return;
		}
		const { center, size } = boundsFrame;
		const fitKey = [
			center.x.toFixed(2),
			center.y.toFixed(2),
			center.z.toFixed(2),
			size.x.toFixed(2),
			size.y.toFixed(2),
			size.z.toFixed(2),
			terrainScene.tiles.length,
			staticRenderableScene.parts.length,
			structuredInteriorScene.cells.length,
		].join(":");

		debugCameraState = fitDebugOrbitCameraToBounds(
			debugCameraState,
			boundsFrame,
			fitKey,
			{ force: forceFit },
		);
		applyDebugCameraFrame();
		reportRenderMetrics();
	}

	function applyDebugCameraFrame(): void {
		const debugCameraFrame: SceneCameraFrame = {
			...buildDebugOrbitCameraFrame(debugCameraState),
			aspect: camera?.aspect ?? 1,
		};
		setActiveCameraFrame(debugCameraFrame, { notifyParent: true });
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
		if (!terrainRoot || !staticRenderableRoot || !structuredInteriorRoot) {
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
		bounds.expandByObject(terrainRoot);
		bounds.expandByObject(staticRenderableRoot);
		bounds.expandByObject(structuredInteriorRoot);
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
			geometry: {
				terrainTileCount: terrainScene.tiles.length,
				terrainVertexCount,
				terrainTriangleCount,
				staticRenderablePartCount: staticRenderableScene.parts.length,
				staticRenderableGeometryCount:
					staticRenderableScene.partsByGfxAssetId.size,
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

	function syncStaticRenderableMeshes(): void {
		if (!staticRenderableRoot) {
			return;
		}

		const partsByGfxAssetId = staticRenderableScene.partsByGfxAssetId;
		const activeGfxAssetIds = new Set(partsByGfxAssetId.keys());

		for (const [gfxAssetId, mesh] of staticRenderableMeshes.entries()) {
			const activeParts = partsByGfxAssetId.get(gfxAssetId);
			if (activeParts && mesh.count === activeParts.length) {
				continue;
			}

			staticRenderableRoot.remove(mesh);
			disposeMeshMaterial(mesh);
			staticRenderableMeshes.delete(gfxAssetId);
		}

		for (const [gfxAssetId, parts] of partsByGfxAssetId.entries()) {
			const geometry = getStaticRenderableGeometry(gfxAssetId);
			if (!geometry) {
				continue;
			}

			let mesh = staticRenderableMeshes.get(gfxAssetId);
			if (!mesh) {
				mesh = createStaticRenderableInstancedMesh(
					gfxAssetId,
					geometry,
					parts.length,
				);
				staticRenderableRoot.add(mesh);
				staticRenderableMeshes.set(gfxAssetId, mesh);
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

		untrack(() => updateCameraFrame());
	}

	function syncStructuredInteriorMeshes(): void {
		if (!structuredInteriorRoot) {
			return;
		}

		const activeRenderKeys = new Set(
			structuredInteriorScene.cells.map((cell) => cell.renderKey),
		);
		for (const [renderKey, mesh] of structuredInteriorMeshes.entries()) {
			if (activeRenderKeys.has(renderKey)) {
				continue;
			}

			structuredInteriorRoot.remove(mesh);
			disposeMesh(mesh);
			structuredInteriorMeshes.delete(renderKey);
		}

		for (const cell of structuredInteriorScene.cells) {
			let mesh = structuredInteriorMeshes.get(cell.renderKey);
			if (!mesh) {
				mesh = createStructuredInteriorCellMesh(cell);
				structuredInteriorRoot.add(mesh);
				structuredInteriorMeshes.set(cell.renderKey, mesh);
			}

			updateStructuredInteriorCellMesh(mesh, cell);
		}

		untrack(() => updateCameraFrame());
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
		return mesh;
	}

	function updateStructuredInteriorCellMesh(
		mesh: Mesh,
		cell: StructuredInteriorCell,
	): void {
		mesh.matrix.copy(
			buildAcPlacementMatrix(
				cell.localPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
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
		mesh.name = `static-renderable/${gfxAssetId}`;
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
