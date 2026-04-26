<script lang="ts">
  import { onMount } from 'svelte';
  import { appShellState, availableModes } from './app/state';
  import { frontendState } from './app/frontend-state';
  import {
    listenForRuntimeLifecycle,
    readHostBoundarySnapshot,
  } from './lib/host/tauri';
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

  onMount(() => {
    let dispose = () => {};

    void (async () => {
      dispose = await listenForRuntimeLifecycle((notification) => {
        frontendState.applyRuntimeNotification(notification);
      });

      const snapshot = await readHostBoundarySnapshot();
      frontendState.loadSnapshot(snapshot);
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
        <span class="badge">{$frontendState.mode.activeModeLabel}</span>
      </header>

      <p>{appShellState.summary}</p>
      <p class="routing-note">{$frontendState.mode.routingReason}</p>

      <div class="mode-list" aria-label="Planned top-level modes">
        {#each availableModes as mode}
          <div class:selected={mode.id === $frontendState.mode.activeMode} class="mode-card">
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
          <h2>{$frontendState.host.boundaryStatus}</h2>
        </div>
        <span class="badge">{$frontendState.host.boundarySnapshot?.source ?? 'loading'}</span>
      </header>

      {#if $frontendState.host.boundarySnapshot}
        <div class="boundary-grid">
          <section>
            <h3>Lifecycle</h3>
            <dl class="data-list">
              <div>
                <dt>Phase</dt>
                <dd>{$frontendState.host.boundarySnapshot.lifecycleState.phase}</dd>
              </div>
              <div>
                <dt>Mode hint</dt>
                <dd>{$frontendState.host.boundarySnapshot.lifecycleState.activeModeHint ?? 'none'}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{$frontendState.host.boundarySnapshot.lifecycleState.sessionState}</dd>
              </div>
            </dl>
            <p>{$frontendState.host.boundarySnapshot.lifecycleState.summary}</p>
          </section>

          <section>
            <h3>Runtime feed</h3>
            <p>Tick {$frontendState.host.boundarySnapshot.runtimeBatch.tick}</p>
            <dl class="data-list compact-data-list">
              <div>
                <dt>Focus landblock</dt>
                <dd>{$frontendState.host.boundarySnapshot.runtimeBatch.residency.focusLandblockId.toString(16)}</dd>
              </div>
              <div>
                <dt>Residency</dt>
                <dd>
                  {$frontendState.host.boundarySnapshot.runtimeBatch.residency.indoors ? 'indoor' : 'outdoor'} / {$frontendState.host.boundarySnapshot.runtimeBatch.residency.trackedBodyCount} bodies
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{$frontendState.host.boundarySnapshot.runtimeBatch.residency.focusLocationLabel}</dd>
              </div>
            </dl>
            <ul>
              {#each $frontendState.host.boundarySnapshot.runtimeBatch.entities as entity}
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
                <dd>{$frontendState.host.boundarySnapshot.viewModelFeed.selectedEntityId ?? 'none'}</dd>
              </div>
              <div>
                <dt>Interaction</dt>
                <dd>{$frontendState.host.boundarySnapshot.viewModelFeed.interactionMode}</dd>
              </div>
              <div>
                <dt>Busy state</dt>
                <dd>{$frontendState.host.boundarySnapshot.viewModelFeed.busyState}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3>Asset channel</h3>
            <p>
              {$frontendState.host.boundarySnapshot.assetResponse.assetId} via {$frontendState.host.boundarySnapshot.assetResponse.payloadKind}
            </p>
            <pre>{JSON.stringify($frontendState.host.boundarySnapshot.assetResponse.payload, null, 2)}</pre>
          </section>
        </div>

        <section class="boundary-notes">
          <h3>Boundary notes</h3>
          <ul>
            {#each $frontendState.host.boundarySnapshot.overview.notes as note}
              <li>{note}</li>
            {/each}
          </ul>
          <p class="event-note">
            Runtime event: {$frontendState.host.boundarySnapshot.overview.runtimeNotificationEvent} /
            latest topic:{' '}
            {$frontendState.host.latestRuntimeNotification?.topic ??
              $frontendState.host.boundarySnapshot.overview.runtimeLifecycleTopic}
          </p>
        </section>
      {/if}
    </article>

    <article class="panel panel-world">
      <p class="kicker">Shared foundation</p>
      <WorldDisplay
        modeLabel={$frontendState.mode.activeModeLabel}
        status={$frontendState.host.boundarySnapshot ? 'Host boundary is feeding authoritative runtime snapshots' : 'Waiting for host boundary'}
        detail={`Shared world-facing infrastructure starts here. Active page: ${$frontendState.mode.activePageId}. ${$frontendState.mode.activeModeSummary}`}
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
