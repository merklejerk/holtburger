<script lang="ts">
  import { onMount } from 'svelte';
  import { appShellState, availableModes, selectedModeLabel } from './app/state';
  import {
    listenForRuntimeLifecycle,
    readHostBoundarySnapshot,
  } from './lib/host/tauri';
  import type {
    HostBoundarySnapshot,
    RuntimeNotificationEnvelopeDto,
  } from './lib/host/contracts';
  import WorldDisplay from './lib/world-display/WorldDisplay.svelte';
  import BrowserModePage from './pages/BrowserModePage.svelte';
  import ClientModePage from './pages/ClientModePage.svelte';

  const contractAreas = [
    'runtime entity snapshots and deltas',
    'authoritative state feeds for view models',
    'asset lookup requests and responses',
    'camera-position hints',
    'mode-driving lifecycle state',
    'ray-pick query contract',
  ] as const;

  let boundarySnapshot: HostBoundarySnapshot | null = null;
  let latestRuntimeNotification: RuntimeNotificationEnvelopeDto | null = null;
  let boundaryStatus = 'Loading host boundary...';

  function applyRuntimeNotification(notification: RuntimeNotificationEnvelopeDto): void {
    latestRuntimeNotification = notification;

    if (!boundarySnapshot) {
      return;
    }

    boundarySnapshot = {
      ...boundarySnapshot,
      lifecycleState: notification.lifecycleState ?? boundarySnapshot.lifecycleState,
      runtimeBatch: notification.runtimeBatch ?? boundarySnapshot.runtimeBatch,
      viewModelFeed: notification.viewModelFeed ?? boundarySnapshot.viewModelFeed,
    };
  }

  onMount(() => {
    let dispose = () => {};

    void (async () => {
      dispose = await listenForRuntimeLifecycle((notification) => {
        applyRuntimeNotification(notification);
      });

      const snapshot = await readHostBoundarySnapshot();
      boundarySnapshot = snapshot;
      boundaryStatus =
        snapshot.source === 'tauri'
          ? 'Connected to the Tauri host boundary with a live authoritative runtime feed.'
          : 'Showing browser-preview fallback data until the Tauri runtime is active.';
    })();

    return () => {
      dispose();
    };
  });
</script>

<svelte:head>
  <title>Holtburger 3D Host Boundary</title>
  <meta
    name="description"
    content="Host boundary for the Holtburger 3D app shell, with typed lifecycle, authoritative runtime, and demand-driven asset contracts."
  />
</svelte:head>

<main class="shell">
  <section class="hero">
    <p class="eyebrow">Host boundary</p>
    <h1>Holtburger 3D Host Boundary</h1>
    <p class="lede">
      This app shell now exposes a typed Tauri boundary with streamed authoritative runtime data,
      lifecycle notifications, and a demand-driven asset channel while keeping renderer details out
      of the host seam.
    </p>
  </section>

  <section class="grid">
    <article class="panel panel-wide">
      <header class="panel-header">
        <div>
          <p class="kicker">App shell</p>
          <h2>{appShellState.title}</h2>
        </div>
        <span class="badge">{selectedModeLabel}</span>
      </header>

      <p>{appShellState.summary}</p>

      <div class="mode-list" aria-label="Planned top-level modes">
        {#each availableModes as mode}
          <div class:selected={mode.id === appShellState.activeMode} class="mode-card">
            <p class="mode-name">{mode.label}</p>
            <p>{mode.summary}</p>
          </div>
        {/each}
      </div>
    </article>

    <article class="panel">
      <p class="kicker">Contract worksheet</p>
      <h2>Contract worksheet anchors</h2>
      <ul>
        {#each contractAreas as area}
          <li>{area}</li>
        {/each}
      </ul>
    </article>

    <article class="panel panel-wide">
      <header class="panel-header">
        <div>
          <p class="kicker">Host boundary</p>
          <h2>{boundaryStatus}</h2>
        </div>
        <span class="badge">{boundarySnapshot?.source ?? 'loading'}</span>
      </header>

      {#if boundarySnapshot}
        <div class="boundary-grid">
          <section>
            <h3>Lifecycle</h3>
            <dl class="data-list">
              <div>
                <dt>Phase</dt>
                <dd>{boundarySnapshot.lifecycleState.phase}</dd>
              </div>
              <div>
                <dt>Mode hint</dt>
                <dd>{boundarySnapshot.lifecycleState.activeModeHint ?? 'none'}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{boundarySnapshot.lifecycleState.sessionState}</dd>
              </div>
            </dl>
            <p>{boundarySnapshot.lifecycleState.summary}</p>
          </section>

          <section>
            <h3>Runtime feed</h3>
            <p>Tick {boundarySnapshot.runtimeBatch.tick}</p>
            <dl class="data-list compact-data-list">
              <div>
                <dt>Focus landblock</dt>
                <dd>{boundarySnapshot.runtimeBatch.residency.focusLandblockId.toString(16)}</dd>
              </div>
              <div>
                <dt>Residency</dt>
                <dd>
                  {boundarySnapshot.runtimeBatch.residency.indoors ? 'indoor' : 'outdoor'} / {boundarySnapshot.runtimeBatch.residency.trackedBodyCount} bodies
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{boundarySnapshot.runtimeBatch.residency.focusLocationLabel}</dd>
              </div>
            </dl>
            <ul>
              {#each boundarySnapshot.runtimeBatch.entities as entity}
                <li>
                  <strong>{entity.label}</strong>
                  {#if entity.isLocalPlayer}
                    (local)
                  {/if}
                  <br />
                  {entity.appearanceId} at ({entity.position.x}, {entity.position.y},
                  {entity.position.z}) in {entity.locationLabel}
                </li>
              {/each}
            </ul>
          </section>

          <section>
            <h3>View-model feed</h3>
            <dl class="data-list">
              <div>
                <dt>Selected entity</dt>
                <dd>{boundarySnapshot.viewModelFeed.selectedEntityId ?? 'none'}</dd>
              </div>
              <div>
                <dt>Interaction</dt>
                <dd>{boundarySnapshot.viewModelFeed.interactionMode}</dd>
              </div>
              <div>
                <dt>Busy state</dt>
                <dd>{boundarySnapshot.viewModelFeed.busyState}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3>Asset channel</h3>
            <p>
              {boundarySnapshot.assetResponse.assetId} via {boundarySnapshot.assetResponse.payloadKind}
            </p>
            <pre>{JSON.stringify(boundarySnapshot.assetResponse.payload, null, 2)}</pre>
          </section>
        </div>

        <section class="boundary-notes">
          <h3>Boundary notes</h3>
          <ul>
            {#each boundarySnapshot.overview.notes as note}
              <li>{note}</li>
            {/each}
          </ul>
          <p class="event-note">
            Runtime event: {boundarySnapshot.overview.runtimeNotificationEvent} / latest topic:{' '}
            {latestRuntimeNotification?.topic ?? boundarySnapshot.overview.runtimeLifecycleTopic}
          </p>
        </section>
      {/if}
    </article>

    <article class="panel panel-world">
      <p class="kicker">Shared foundation</p>
      <WorldDisplay
        modeLabel={selectedModeLabel}
        status={boundarySnapshot ? 'Host boundary is feeding authoritative runtime snapshots' : 'Waiting for host boundary'}
        detail="Shared world-facing infrastructure starts here; browser mode remains the first consumer, now backed by a real world-state-to-runtime feed instead of app-local DTO stubs."
      />
    </article>

    <article class="panel">
      <BrowserModePage />
    </article>

    <article class="panel">
      <ClientModePage />
    </article>
  </section>
</main>
