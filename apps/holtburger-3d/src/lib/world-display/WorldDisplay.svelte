<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    AmbientLight,
    Box3,
    BufferAttribute,
    BufferGeometry,
    Color,
    DirectionalLight,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Quaternion as ThreeQuaternion,
    Raycaster,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
  } from 'three';

  import type { BrowserLocationSelection } from '../../app/browser-mode';
  import type { AppModeId } from '../../app/modes';
  import type { AssetChannelState, PreparedGfxObjRenderGeometry, PreparedTerrainMesh } from '../assets/types';
  import type { CameraHintAckDto, FrontendStateFeedDto, RayPickResponseDto, RuntimeBatchDto } from '../host/contracts';
  import { resolveRayPick, submitCameraHint } from '../host/tauri';
  import {
    deriveStaticRenderableSceneModel,
    type StaticRenderablePart,
    isPreparedGfxObjAsset,
  } from './static-renderables';
  import {
    buildCameraHint,
    buildRayPickRequest,
    describeCameraHintAck,
    describeRayPickResponse,
    deriveWorldDisplayModel,
    normalizeViewportPoint,
    shouldSendThrottledCameraHint,
    type NormalizedViewportPoint,
  } from './model';
  import { deriveTerrainSceneModel, type TerrainSceneTile } from './terrain-scene';
  import {
    buildCameraHintFromSceneCameraFrame,
    buildDebugOrbitCameraFrame,
    createDebugOrbitCameraState,
    describeSceneCameraFrame,
    fitDebugOrbitCameraToBounds,
    orbitDebugCamera,
    panDebugCamera,
    zoomDebugCamera,
    type DebugOrbitCameraState,
    type SceneCameraFrame,
  } from './camera';

  let {
    activeMode,
    activeModeLabel,
    hostStatus,
    runtimeBatch,
    viewModelFeed,
    assetState,
    browserDestination,
    landblockCoverageRadius,
  }: {
    activeMode: AppModeId;
    activeModeLabel: string;
    hostStatus: string;
    runtimeBatch: RuntimeBatchDto | null;
    viewModelFeed: FrontendStateFeedDto | null;
    assetState: AssetChannelState;
    browserDestination: BrowserLocationSelection | null;
    landblockCoverageRadius: number;
  } = $props();

  const CAMERA_HINT_INTERVAL_MS = 250;

  let cameraAck = $state<CameraHintAckDto | null>(null);
  let rayPickResponse = $state<RayPickResponseDto | null>(null);
  let lastCameraHintAt = $state<number | null>(null);
  let trailingCameraHint = $state<ReturnType<typeof buildCameraHint> | null>(null);
  let cameraHintTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAutoHintKey = $state<string | null>(null);
  let viewportHost = $state<HTMLDivElement | null>(null);
  let renderer: WebGLRenderer | null = null;
  let scene: Scene | null = null;
  let camera: PerspectiveCamera | null = null;
  let terrainRoot: Group | null = null;
  let staticRenderableRoot: Group | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let sceneGeometryText = $state('No terrain geometry is cached yet.');
  let staticRenderableText = $state('No static renderables are cached yet.');
  let sceneBoundsText = $state('Scene bounds are unavailable until terrain is framed.');
  let cameraFrameText = $state('Camera frame is waiting for terrain.');
  let debugCameraState = $state<DebugOrbitCameraState>(createDebugOrbitCameraState());
  let activeCameraFrame = $state<SceneCameraFrame | null>(null);
  let activePointerDrag = $state<{
    pointerId: number;
    lastX: number;
    lastY: number;
    mode: 'orbit' | 'pan';
    moved: boolean;
  } | null>(null);
  let suppressNextClick = false;
  const terrainMeshes = new Map<string, Mesh>();
  const staticGeometryCache = new Map<string, BufferGeometry>();
  const staticRenderableMeshes = new Map<string, InstancedMesh>();
  const terrainRaycaster = new Raycaster();

  const terrainScene = $derived(
    deriveTerrainSceneModel(
      runtimeBatch,
      assetState,
      browserDestination,
      landblockCoverageRadius,
    ),
  );
  const staticRenderableScene = $derived(
    deriveStaticRenderableSceneModel(
      runtimeBatch,
      assetState,
      browserDestination,
      landblockCoverageRadius,
    ),
  );

  const terrainVertexCount = $derived(
    terrainScene.tiles.reduce((total, tile) => total + tile.mesh.vertices.length, 0),
  );
  const terrainTriangleCount = $derived(
    terrainScene.tiles.reduce((total, tile) => total + tile.mesh.triangles.length, 0),
  );
  const terrainMinHeight = $derived(
    terrainScene.tiles.length === 0
      ? null
      : Math.min(...terrainScene.tiles.map((tile) => tile.mesh.minHeight)),
  );
  const terrainMaxHeight = $derived(
    terrainScene.tiles.length === 0
      ? null
      : Math.max(...terrainScene.tiles.map((tile) => tile.mesh.maxHeight)),
  );
  const terrainHeightText = $derived(
    terrainMinHeight === null || terrainMaxHeight === null
      ? 'No terrain heights are cached yet.'
      : `Height range ${terrainMinHeight.toFixed(1)} to ${terrainMaxHeight.toFixed(1)} across cached tiles.`,
  );
  const assetDebugText = $derived(describeAssetDebugState());

  const worldDisplay = $derived(
    deriveWorldDisplayModel({
      activeModeLabel,
      hostStatus,
      runtimeBatch,
      viewModelFeed,
      assetState,
      browserDestination,
      landblockCoverageRadius,
      cameraAck,
      rayPickResponse,
      pendingCameraHint: trailingCameraHint !== null,
    }),
  );

  const autoCameraHint = $derived(
    activeCameraFrame
      ? buildCameraHintFromSceneCameraFrame(
          activeMode,
          runtimeBatch,
          browserDestination,
          activeCameraFrame,
          { normalizedX: 0.5, normalizedY: 0.5 },
        )
      : buildCameraHint(activeMode, runtimeBatch, browserDestination),
  );
  const autoHintKey = $derived(
    autoCameraHint
    ? [
        autoCameraHint.destinationLabel ?? 'runtime',
        autoCameraHint.position.x.toFixed(2),
        autoCameraHint.position.y.toFixed(2),
        autoCameraHint.forward.x.toFixed(2),
        autoCameraHint.forward.y.toFixed(2),
        autoCameraHint.forward.z.toFixed(2),
      ].join(':')
    : null,
  );

  $effect(() => {
    if (
      autoCameraHint &&
      autoHintKey !== lastAutoHintKey &&
      !debugCameraState.hasManualControl
    ) {
      lastAutoHintKey = autoHintKey;
      scheduleCameraHint(autoCameraHint, true);
    }
  });

  $effect(() => {
    if (!viewportHost) {
      return;
    }

    const host = viewportHost;
    const nextRenderer = new WebGLRenderer({ antialias: true, alpha: true });
    nextRenderer.setPixelRatio(window.devicePixelRatio);
    nextRenderer.outputColorSpace = 'srgb';
    nextRenderer.domElement.className = 'world-display__three-canvas';
    host.append(nextRenderer.domElement);

    const nextScene = new Scene();
    nextScene.background = new Color('#0e1a24');

    const nextCamera = new PerspectiveCamera(52, 1, 0.1, 5000);

    const ambientLight = new AmbientLight('#d7e9f9', 1.4);
    const sunLight = new DirectionalLight('#fff1d6', 2.1);
    sunLight.position.set(220, 320, 160);
    nextScene.add(ambientLight, sunLight);

    const nextTerrainRoot = new Group();
    const nextStaticRenderableRoot = new Group();
    nextScene.add(nextTerrainRoot);
    nextScene.add(nextStaticRenderableRoot);

    renderer = nextRenderer;
    scene = nextScene;
    camera = nextCamera;
    terrainRoot = nextTerrainRoot;
    staticRenderableRoot = nextStaticRenderableRoot;

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
      if (renderer === nextRenderer && scene === nextScene && camera === nextCamera) {
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
      nextTerrainRoot.clear();
      nextStaticRenderableRoot.clear();
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
    };
  });

  $effect(() => {
    syncTerrainMeshes();
  });

  $effect(() => {
    syncStaticRenderableMeshes();
  });

  onDestroy(() => {
    if (cameraHintTimer) {
      clearTimeout(cameraHintTimer);
    }
  });

  export function pickTerrainLandblockAtViewportPoint(
    viewportPoint: NormalizedViewportPoint,
  ): number | null {
    return pickTerrainLandblock(viewportPoint);
  }

  function handleViewportPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    activePointerDrag = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      mode: event.button === 0 ? 'orbit' : 'pan',
      moved: false,
    };
    event.preventDefault();
  }

  function handleViewportPointerMove(event: PointerEvent): void {
    const drag = activePointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      const viewportPoint = getViewportPoint(event);
      scheduleRenderedCameraHint(viewportPoint, false);
      return;
    }

    const delta = {
      x: event.clientX - drag.lastX,
      y: event.clientY - drag.lastY,
    };
    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    activePointerDrag = {
      ...drag,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: drag.moved || Math.hypot(delta.x, delta.y) > 2,
    };
    debugCameraState =
      drag.mode === 'orbit'
        ? orbitDebugCamera(debugCameraState, delta)
        : panDebugCamera(debugCameraState, delta);
    applyDebugCameraFrame();
    scheduleRenderedCameraHint(getViewportPoint(event), false);
    event.preventDefault();
  }

  function handleViewportPointerUp(event: PointerEvent): void {
    const drag = activePointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    suppressNextClick = drag.moved;
    activePointerDrag = null;
    event.preventDefault();
  }

  function handleViewportWheel(event: WheelEvent): void {
    debugCameraState = zoomDebugCamera(debugCameraState, event.deltaY);
    applyDebugCameraFrame();
    scheduleRenderedCameraHint(getViewportPoint(event), false);
    event.preventDefault();
  }

  function handleViewportKeyDown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 'f') {
      return;
    }

    updateCameraFrame(true);
    scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
    event.preventDefault();
  }

  function handleViewportContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  async function handleViewportClick(event: MouseEvent): Promise<void> {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    const viewportPoint = getViewportPoint(event);
    const hint = buildRenderedCameraHint(viewportPoint);

    if (!hint) {
      return;
    }

    await flushCameraHint(hint);
    rayPickResponse = await resolveRayPick(
      buildRayPickRequest(hint, `world-display-pick-${Date.now()}`),
    );
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

    return typeof landblockId === 'number' ? landblockId : null;
  }

  function getViewportPoint(event: MouseEvent | PointerEvent | WheelEvent): NormalizedViewportPoint {
    const viewport = event.currentTarget as HTMLElement;
    const rect = viewport.getBoundingClientRect();
    return normalizeViewportPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  function scheduleRenderedCameraHint(
    viewportPoint: NormalizedViewportPoint,
    immediate: boolean,
  ): void {
    const hint = buildRenderedCameraHint(viewportPoint);

    if (!hint) {
      return;
    }

    scheduleCameraHint(hint, immediate);
  }

  function buildRenderedCameraHint(
    viewportPoint: NormalizedViewportPoint,
  ): NonNullable<ReturnType<typeof buildCameraHint>> | null {
    if (!activeCameraFrame) {
      return buildCameraHint(activeMode, runtimeBatch, browserDestination, viewportPoint);
    }

    return buildCameraHintFromSceneCameraFrame(
      activeMode,
      runtimeBatch,
      browserDestination,
      activeCameraFrame,
      viewportPoint,
    );
  }

  function scheduleCameraHint(
    hint: NonNullable<ReturnType<typeof buildCameraHint>>,
    immediate: boolean,
  ): void {
    const now = Date.now();

    if (immediate || shouldSendThrottledCameraHint(lastCameraHintAt, now, CAMERA_HINT_INTERVAL_MS)) {
      if (cameraHintTimer) {
        clearTimeout(cameraHintTimer);
        cameraHintTimer = null;
      }
      trailingCameraHint = null;
      void flushCameraHint(hint);
      return;
    }

    trailingCameraHint = hint;

    if (cameraHintTimer) {
      return;
    }

    const remainingDelay = CAMERA_HINT_INTERVAL_MS - (now - (lastCameraHintAt ?? now));
    cameraHintTimer = setTimeout(() => {
      cameraHintTimer = null;
      const nextHint = trailingCameraHint;
      trailingCameraHint = null;

      if (nextHint) {
        void flushCameraHint(nextHint);
      }
    }, Math.max(remainingDelay, 0));
  }

  async function flushCameraHint(
    hint: NonNullable<ReturnType<typeof buildCameraHint>>,
  ): Promise<void> {
    cameraAck = await submitCameraHint(hint);
    lastCameraHintAt = Date.now();
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

    const activeAssetIds = new Set(terrainScene.tiles.map((tile) => tile.assetId));
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

    sceneGeometryText = terrainScene.tiles.length === 0
      ? 'No terrain geometry is cached yet.'
      : `${terrainScene.tiles.length} tile${terrainScene.tiles.length === 1 ? '' : 's'}, ${terrainVertexCount} vertices, ${terrainTriangleCount} triangles.`;

    untrack(() => updateCameraFrame());
  }

  function updateCameraFrame(forceFit = false): void {
    if (!camera || !terrainRoot || !staticRenderableRoot) {
      return;
    }

    if (terrainScene.tiles.length === 0 && staticRenderableScene.parts.length === 0) {
      activeCameraFrame = {
        position: { x: 180, y: 220, z: 180 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        aspect: camera.aspect,
        fovDegrees: 52,
        near: 0.1,
        far: 5000,
      };
      applySceneCameraFrame(activeCameraFrame);
      sceneBoundsText = 'Scene bounds are unavailable until terrain is framed.';
      cameraFrameText = `${describeSceneCameraFrame(activeCameraFrame)} ${describeCameraControlMode()}`;
      return;
    }

    const bounds = new Box3();
    bounds.expandByObject(terrainRoot);
    bounds.expandByObject(staticRenderableRoot);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const fitKey = [
      center.x.toFixed(2),
      center.y.toFixed(2),
      center.z.toFixed(2),
      size.x.toFixed(2),
      size.y.toFixed(2),
      size.z.toFixed(2),
      terrainScene.tiles.length,
      staticRenderableScene.parts.length,
    ].join(':');

    debugCameraState = fitDebugOrbitCameraToBounds(
      debugCameraState,
      {
        center: { x: center.x, y: center.y, z: center.z },
        size: { x: size.x, y: size.y, z: size.z },
        minimumSpan: 180,
      },
      fitKey,
      { force: forceFit },
    );
    applyDebugCameraFrame();
    sceneBoundsText = `Center (${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}) span (${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)}).`;
  }

  function applyDebugCameraFrame(): void {
    activeCameraFrame = {
      ...buildDebugOrbitCameraFrame(debugCameraState),
      aspect: camera?.aspect ?? 1,
    };
    applySceneCameraFrame(activeCameraFrame);
    cameraFrameText = `${describeSceneCameraFrame(activeCameraFrame)} ${describeCameraControlMode()}`;
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

  function describeCameraControlMode(): string {
    return debugCameraState.hasManualControl
      ? 'Browser camera: manual orbit.'
      : 'Browser camera: auto-fit.';
  }

  function describeAssetDebugState(): string {
    if (assetState.errorMessage) {
      return `Error while preparing ${assetState.activeRequest?.assetId ?? 'asset'}: ${assetState.errorMessage}`;
    }

    const preparedCount = Object.keys(assetState.preparedByAssetId).length;
    const activeAssetId = assetState.activeRequest?.assetId ?? 'none';
    const recentActivity = assetState.history.at(-1);
    const recentText = recentActivity
      ? `${recentActivity.status} ${recentActivity.assetId}`
      : 'no asset activity yet';

    return `${assetState.status}; active ${activeAssetId}; prepared ${preparedCount}; latest ${recentText}.`;
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
        mesh = createStaticRenderableInstancedMesh(gfxAssetId, geometry, parts.length);
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

    staticRenderableText =
      staticRenderableScene.parts.length === 0
        ? describeStaticRenderableIdleState()
        : `${staticRenderableScene.parts.length} static renderable part${staticRenderableScene.parts.length === 1 ? '' : 's'} across ${partsByGfxAssetId.size} shared gfx geometr${partsByGfxAssetId.size === 1 ? 'y' : 'ies'}.`;

    untrack(() => updateCameraFrame());
  }

  function describeStaticRenderableIdleState(): string {
    if (staticRenderableScene.sourceInstances.length === 0) {
      return 'No static renderable source facts are active for the current outdoor coverage.';
    }

    if (staticRenderableScene.missingSourceAssetIds.length > 0) {
      return `Waiting for ${staticRenderableScene.missingSourceAssetIds.length} static renderable source asset${staticRenderableScene.missingSourceAssetIds.length === 1 ? '' : 's'}.`;
    }

    if (staticRenderableScene.missingGfxAssetIds.length > 0) {
      return `Waiting for ${staticRenderableScene.missingGfxAssetIds.length} gfx geometry dependenc${staticRenderableScene.missingGfxAssetIds.length === 1 ? 'y' : 'ies'}.`;
    }

    return 'Static renderable source facts are active, but no drawable gfx geometry is ready.';
  }

  function getStaticRenderableGeometry(gfxAssetId: string): BufferGeometry | null {
    const cachedGeometry = staticGeometryCache.get(gfxAssetId);
    if (cachedGeometry) {
      return cachedGeometry;
    }

    const asset = assetState.preparedByAssetId[gfxAssetId];
    if (!isPreparedGfxObjAsset(asset) || asset.payload.renderGeometry.vertexCount === 0) {
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
      color: '#ffffff',
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

  function buildStaticRenderablePartMatrix(part: StaticRenderablePart): Matrix4 {
    const matrix = frameToMatrix(part.instanceFrame, { x: 1, y: 1, z: 1 });
    for (const placementFrame of part.placementFrames) {
      matrix.multiply(frameToMatrix(placementFrame, { x: 1, y: 1, z: 1 }));
    }
    matrix.multiply(new Matrix4().makeScale(part.scale.x, part.scale.z, part.scale.y));
    return matrix;
  }

  function frameToMatrix(frame: StaticRenderablePart['instanceFrame'], scale: { x: number; y: number; z: number }): Matrix4 {
    return new Matrix4().compose(
      new Vector3(frame.origin.x, frame.origin.z, -frame.origin.y),
      convertAcQuaternion(frame.orientation),
      new Vector3(scale.x, scale.y, scale.z),
    );
  }

  function convertAcQuaternion(quaternion: StaticRenderablePart['instanceFrame']['orientation']): ThreeQuaternion {
    const acRotation = new Matrix4().makeRotationFromQuaternion(
      new ThreeQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
    );
    const acToThree = new Matrix4().set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, -1, 0, 0,
      0, 0, 0, 1,
    );
    const threeToAc = acToThree.clone().invert();
    const threeRotation = acToThree.multiply(acRotation).multiply(threeToAc);
    return new ThreeQuaternion().setFromRotationMatrix(threeRotation);
  }

  function buildGfxObjGeometry(renderGeometry: PreparedGfxObjRenderGeometry): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(convertAcVectorTriplets(renderGeometry.positions), 3),
    );
    if (renderGeometry.normals.length === renderGeometry.positions.length) {
      geometry.setAttribute('normal', new BufferAttribute(convertAcVectorTriplets(renderGeometry.normals), 3));
    } else {
      geometry.computeVertexNormals();
    }
    if (renderGeometry.uvs.length > 0) {
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(renderGeometry.uvs), 2));
    }
    return geometry;
  }

  function convertAcVectorTriplets(values: number[]): Float32Array {
    const converted = new Float32Array(values.length);
    for (let index = 0; index < values.length; index += 3) {
      converted[index] = values[index] ?? 0;
      converted[index + 1] = values[index + 2] ?? 0;
      converted[index + 2] = -(values[index + 1] ?? 0);
    }
    return converted;
  }

  function buildStaticRenderableColor(debugColorKey: string): Color {
    let hash = 0;
    for (let index = 0; index < debugColorKey.length; index += 1) {
      hash = (hash * 31 + debugColorKey.charCodeAt(index)) >>> 0;
    }

    return new Color().setHSL((hash % 360) / 360, 0.54, 0.48);
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

  function buildTerrainGeometry(terrainMesh: PreparedTerrainMesh): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions: number[] = [];
    const colors: number[] = [];

    for (const triangle of terrainMesh.triangles) {
      const vertices = [triangle.a, triangle.b, triangle.c].map((index) => terrainMesh.vertices[index]);
      const color = buildTerrainColor(
        terrainMesh,
        triangle.terrainType,
        triangle.averageHeight,
      );

      for (const vertex of vertices) {
        positions.push(vertex.x, vertex.z, -vertex.y);
        colors.push(color.r, color.g, color.b);
      }
    }

    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  function buildTerrainColor(
    terrainMesh: PreparedTerrainMesh,
    terrainType: number,
    averageHeight: number,
  ): Color {
    const terrainHues = [152, 104, 44, 190, 128, 24];
    const absoluteHeightFactor = clamp((averageHeight + 12) / 72, 0, 1);
    const localHeightSpan = Math.max(terrainMesh.maxHeight - terrainMesh.minHeight, 1);
    const localHeightFactor = clamp(
      (averageHeight - terrainMesh.minHeight) / localHeightSpan,
      0,
      1,
    );

    return new Color().setHSL(
      terrainHues[terrainType % terrainHues.length] / 360,
      0.34 + absoluteHeightFactor * 0.12,
      0.22 + absoluteHeightFactor * 0.18 + localHeightFactor * 0.08,
    );
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
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
    onpointerdown={handleViewportPointerDown}
    onpointermove={handleViewportPointerMove}
    onpointerup={handleViewportPointerUp}
    onpointercancel={handleViewportPointerUp}
    onwheel={handleViewportWheel}
    onkeydown={handleViewportKeyDown}
    oncontextmenu={handleViewportContextMenu}
    onclick={handleViewportClick}
  >
    <div class="world-display__viewport">
      <div bind:this={viewportHost} class="world-display__three-host"></div>

      <div class="world-display__hud world-display__hud--top-left">
        <p class="world-display__eyebrow">Scene</p>
        <dl class="world-display__hud-list">
          <div>
            <dt>Focus</dt>
            <dd>{worldDisplay.focusLocationLabel}</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>{terrainScene.cacheText}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{terrainScene.dataSourceText}</dd>
          </div>
          <div>
            <dt>Geometry</dt>
            <dd>{sceneGeometryText}</dd>
          </div>
          <div>
            <dt>Assets</dt>
            <dd>{assetDebugText}</dd>
          </div>
          <div>
            <dt>Statics</dt>
            <dd>{staticRenderableText}</dd>
          </div>
          <div>
            <dt>Heights</dt>
            <dd>{terrainHeightText}</dd>
          </div>
          <div>
            <dt>Bounds</dt>
            <dd>{sceneBoundsText}</dd>
          </div>
          <div>
            <dt>Camera</dt>
            <dd>{cameraFrameText}</dd>
          </div>
        </dl>
      </div>

      <div class="world-display__viewport-copy">
        <p>{terrainScene.statusText}</p>
        <p>{worldDisplay.inputText}</p>
      </div>
    </div>
  </button>

  <div class="world-display__telemetry">
    <p>
      Camera hint:{' '}
      {describeCameraHintAck(cameraAck) ?? 'Waiting for the first world-display camera hint acknowledgement.'}
    </p>
    <p>
      Ray pick:{' '}
      {describeRayPickResponse(rayPickResponse) ?? 'No authority-sensitive debug pick has been resolved yet.'}
    </p>
  </div>
</div>
