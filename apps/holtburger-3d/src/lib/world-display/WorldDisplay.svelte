<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    AmbientLight,
    Box3,
    BufferAttribute,
    BufferGeometry,
    Color,
    DirectionalLight,
    Group,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer,
  } from 'three';

  import type { BrowserLocationSelection } from '../../app/browser-mode';
  import type { AppModeId } from '../../app/modes';
  import type { AssetChannelState, PreparedTerrainMesh } from '../assets/types';
  import type { CameraHintAckDto, FrontendStateFeedDto, RayPickResponseDto, RuntimeBatchDto } from '../host/contracts';
  import { resolveRayPick, submitCameraHint } from '../host/tauri';
  import {
    buildCameraHint,
    buildRayPickRequest,
    deriveWorldDisplayModel,
    normalizeViewportPoint,
    shouldSendThrottledCameraHint,
    type NormalizedViewportPoint,
  } from './model';
  import { deriveTerrainSceneModel, type TerrainSceneTile } from './terrain-scene';

  let {
    activeMode,
    activeModeLabel,
    hostStatus,
    runtimeBatch,
    viewModelFeed,
    assetState,
    browserDestination,
  }: {
    activeMode: AppModeId;
    activeModeLabel: string;
    hostStatus: string;
    runtimeBatch: RuntimeBatchDto | null;
    viewModelFeed: FrontendStateFeedDto | null;
    assetState: AssetChannelState;
    browserDestination: BrowserLocationSelection | null;
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
  let resizeObserver: ResizeObserver | null = null;
  let sceneGeometrySummary = $state('No terrain geometry is cached yet.');
  let sceneBoundsSummary = $state('Scene bounds are unavailable until terrain is framed.');
  let cameraFrameSummary = $state('Camera frame is waiting for terrain.');
  const terrainMeshes = new Map<string, Mesh>();

  const terrainScene = $derived(deriveTerrainSceneModel(runtimeBatch, assetState, browserDestination));

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
  const terrainHeightSummary = $derived(
    terrainMinHeight === null || terrainMaxHeight === null
      ? 'No terrain heights are cached yet.'
      : `Height range ${terrainMinHeight.toFixed(1)} to ${terrainMaxHeight.toFixed(1)} across cached tiles.`,
  );

  const worldDisplay = $derived(
    deriveWorldDisplayModel({
      activeModeLabel,
      hostStatus,
      runtimeBatch,
      viewModelFeed,
      assetState,
      browserDestination,
      cameraAck,
      rayPickResponse,
      pendingCameraHint: trailingCameraHint !== null,
    }),
  );

  const autoCameraHint = $derived(buildCameraHint(activeMode, runtimeBatch, browserDestination));
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
    if (autoCameraHint && autoHintKey !== lastAutoHintKey) {
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
    nextScene.add(nextTerrainRoot);

    renderer = nextRenderer;
    scene = nextScene;
    camera = nextCamera;
    terrainRoot = nextTerrainRoot;

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
      nextTerrainRoot.clear();
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
    };
  });

  $effect(() => {
    syncTerrainMeshes();
  });

  onDestroy(() => {
    if (cameraHintTimer) {
      clearTimeout(cameraHintTimer);
    }
  });

  function handleViewportMove(event: MouseEvent): void {
    const viewportPoint = getViewportPoint(event);
    const hint = buildCameraHint(activeMode, runtimeBatch, browserDestination, viewportPoint);

    if (!hint) {
      return;
    }

    scheduleCameraHint(hint, false);
  }

  async function handleViewportClick(event: MouseEvent): Promise<void> {
    const viewportPoint = getViewportPoint(event);
    const hint = buildCameraHint(activeMode, runtimeBatch, browserDestination, viewportPoint);

    if (!hint) {
      return;
    }

    await flushCameraHint(hint);
    rayPickResponse = await resolveRayPick(
      buildRayPickRequest(hint, `world-display-pick-${Date.now()}`),
    );
  }

  function getViewportPoint(event: MouseEvent): NormalizedViewportPoint {
    const viewport = event.currentTarget as HTMLElement;
    const rect = viewport.getBoundingClientRect();
    return normalizeViewportPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
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
      terrainRoot.add(mesh);
      terrainMeshes.set(tile.assetId, mesh);
    }

    sceneGeometrySummary = terrainScene.tiles.length === 0
      ? 'No terrain geometry is cached yet.'
      : `${terrainScene.tiles.length} tile${terrainScene.tiles.length === 1 ? '' : 's'}, ${terrainVertexCount} vertices, ${terrainTriangleCount} triangles.`;

    updateCameraFrame();
  }

  function updateCameraFrame(): void {
    if (!camera || !terrainRoot) {
      return;
    }

    if (terrainScene.tiles.length === 0) {
      camera.position.set(180, 220, 180);
      camera.lookAt(0, 0, 0);
      sceneBoundsSummary = 'Scene bounds are unavailable until terrain is framed.';
      cameraFrameSummary = 'Camera parked at (180.0, 220.0, 180.0) looking at (0.0, 0.0, 0.0).';
      return;
    }

    const bounds = new Box3().setFromObject(terrainRoot);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const span = Math.max(size.x, size.z, 180);
    const verticalSpan = Math.max(size.y, 24);

    camera.position.set(
      center.x + span * 0.95,
      center.y + verticalSpan + span * 0.72,
      center.z + span * 0.9,
    );
    camera.lookAt(center.x, center.y, center.z);
    sceneBoundsSummary = `Center (${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}) span (${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)}).`;
    cameraFrameSummary = `Camera (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}) looking at (${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}).`;
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
    class="world-display__viewport-button"
    type="button"
    onmousemove={handleViewportMove}
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
            <dd>{terrainScene.cacheSummary}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{terrainScene.dataSourceSummary}</dd>
          </div>
          <div>
            <dt>Geometry</dt>
            <dd>{sceneGeometrySummary}</dd>
          </div>
          <div>
            <dt>Heights</dt>
            <dd>{terrainHeightSummary}</dd>
          </div>
          <div>
            <dt>Bounds</dt>
            <dd>{sceneBoundsSummary}</dd>
          </div>
          <div>
            <dt>Camera</dt>
            <dd>{cameraFrameSummary}</dd>
          </div>
        </dl>
      </div>

      <div class="world-display__reticle"></div>

      <div class="world-display__viewport-copy">
        <p>{terrainScene.summary}</p>
        <p>{worldDisplay.inputSummary}</p>
      </div>
    </div>
  </button>

  <div class="world-display__telemetry">
    <p>
      Camera hint:{' '}
      {cameraAck?.summary ?? 'Waiting for the first world-display camera hint acknowledgement.'}
    </p>
    <p>
      Ray pick:{' '}
      {rayPickResponse?.summary ?? 'No authority-sensitive debug pick has been resolved yet.'}
    </p>
  </div>
</div>