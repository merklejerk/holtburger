<script lang="ts">
  import { onDestroy } from 'svelte';

  import type { BrowserLocationSelection } from '../../app/browser-mode';
  import type { AppModeId } from '../../app/modes';
  import type { AssetChannelState } from '../assets/types';
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
</script>

<div class="world-display">
  <div class="world-display__header">
    <p class="world-display__eyebrow">WorldDisplay</p>
    <span>{activeModeLabel}</span>
  </div>

  <div class="world-display__status-grid">
    <section class="world-display__status-card">
      <h3>Scene host</h3>
      <p>{worldDisplay.headline}</p>
      <dl class="data-list compact-data-list">
        <div>
          <dt>Focus</dt>
          <dd>{worldDisplay.focusLocationLabel}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{worldDisplay.destinationLabel}</dd>
        </div>
      </dl>
    </section>

    <section class="world-display__status-card">
      <h3>Render cache shell</h3>
      <p>{worldDisplay.renderCacheSummary}</p>
    </section>

    <section class="world-display__status-card">
      <h3>Input mapping shell</h3>
      <p>{worldDisplay.inputSummary}</p>
    </section>

    <section class="world-display__status-card">
      <h3>Asset worker ingress</h3>
      <p>{worldDisplay.assetSummary}</p>
    </section>
  </div>

  <div class="world-display__status-grid">
    <section class="world-display__status-card world-display__status-card--wide">
      <h3>Outdoor scene context</h3>
      <p>{worldDisplay.sceneContext.summary}</p>
      <dl class="data-list compact-data-list">
        <div>
          <dt>Focus landblock</dt>
          <dd>{worldDisplay.sceneContext.focusLandblockLabel}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{worldDisplay.sceneContext.coverageSummary}</dd>
        </div>
      </dl>
      <p>{worldDisplay.sceneContext.destinationSummary}</p>
      {#if worldDisplay.sceneContext.gapSummary}
        <p>{worldDisplay.sceneContext.gapSummary}</p>
      {/if}

      {#if worldDisplay.sceneContext.chunks.length > 0}
        <ul class="world-display__chunk-list">
          {#each worldDisplay.sceneContext.chunks as chunk}
            <li>
              <strong>{chunk.label}</strong>
              {' '}
              ({chunk.role === 'focus' ? 'focus' : `offset ${chunk.offsetX}, ${chunk.offsetY}`})
              <br />
              {chunk.reason}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="world-display__status-card world-display__status-card--wide">
      <h3>Terrain ground truth</h3>
      <p>{worldDisplay.terrainContract.summary}</p>
      <dl class="data-list compact-data-list">
        <div>
          <dt>Request key</dt>
          <dd>{worldDisplay.terrainContract.requestKey ?? 'pending outdoor focus landblock'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{worldDisplay.terrainContract.sourceAssetKind}</dd>
        </div>
        <div>
          <dt>Decode owner</dt>
          <dd>{worldDisplay.terrainContract.decodeOwner}</dd>
        </div>
        <div>
          <dt>Render owner</dt>
          <dd>{worldDisplay.terrainContract.renderOwner}</dd>
        </div>
      </dl>
      <p>Load anchor: {worldDisplay.terrainContract.loadAnchor}</p>
      <p>Geometry anchor: {worldDisplay.terrainContract.geometryAnchor}</p>
      <p>{worldDisplay.terrainContract.indoorBranchSummary}</p>
    </section>
  </div>

  <button
    class="world-display__viewport-button"
    type="button"
    onmousemove={handleViewportMove}
    onclick={handleViewportClick}
  >
    <div class="world-display__viewport">
      <div class="world-display__reticle"></div>
      {#each worldDisplay.entities as entity}
        <div
          class:selected={entity.isSelected}
          class:local={entity.isLocalPlayer}
          class="world-display__marker"
          style={`left: ${entity.screenXPercent}%; top: ${entity.screenYPercent}%;`}
        >
          <span>{entity.label}</span>
        </div>
      {/each}

      <div class="world-display__viewport-copy">
        <p>Move across the viewport to throttle camera hints. Click to resolve the first authority-sensitive debug pick.</p>
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