<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { frontendState } from './app/frontend-state';
  import {
    AssetChannelController,
    createSceneCoverageRequests,
  } from './lib/assets/asset-channel';
  import {
    listenForRuntimeLifecycle,
    readHostBoundarySnapshot,
  } from './lib/host/tauri';
  import type { AssetPriority, RuntimeBatchDto } from './lib/host/contracts';
  import WorldDisplay from './lib/world-display/WorldDisplay.svelte';
  import BrowserModePage from './pages/BrowserModePage.svelte';

  const tauriLaunchCommand = 'npm run tauri:dev';
  let startupError = $state<string | null>(null);

  onMount(() => {
    let dispose = () => {};
    let disposed = false;
    const assetChannel = new AssetChannelController();
    const inFlightSceneAssetIds = new Set<string>();

    async function syncSceneCoverage(
      runtimeBatch: RuntimeBatchDto | null,
      browserDestination: typeof $frontendState.browserMode.destination,
      priority: AssetPriority,
    ): Promise<void> {
      const assetState = get(frontendState).asset;
      const requests = createSceneCoverageRequests(
        runtimeBatch,
        browserDestination,
        priority,
        assetState.preparedByAssetId,
        [...inFlightSceneAssetIds],
      );

      if (requests.length === 0) {
        return;
      }

      await Promise.allSettled(
        requests.map(async (request) => {
          inFlightSceneAssetIds.add(request.assetId);
          frontendState.markAssetPending(request);

          try {
            const preparedGraph = await assetChannel.prepareAssetGraph(
              request,
              { ...get(frontendState).asset.preparedByAssetId },
            );
            if (!disposed) {
              for (const preparedAsset of preparedGraph.preparedAssets) {
                frontendState.applyPreparedAsset(preparedAsset);
              }
            }
          } catch (error) {
            if (!disposed) {
              frontendState.applyAssetError(
                request,
                error instanceof Error ? error.message : String(error),
              );
            }
          } finally {
            inFlightSceneAssetIds.delete(request.assetId);
          }
        }),
      );
    }

    void (async () => {
      try {
        dispose = await listenForRuntimeLifecycle((notification) => {
          frontendState.applyRuntimeNotification(notification);
          if (notification.runtimeBatch) {
            void syncSceneCoverage(
              notification.runtimeBatch,
              $frontendState.browserMode.destination,
              'streaming',
            );
          }
        });

        const snapshot = await readHostBoundarySnapshot();
        frontendState.loadSnapshot(snapshot);
        startupError = null;

        await Promise.all([
          syncSceneCoverage(
            snapshot.runtimeBatch,
            $frontendState.browserMode.destination,
            'bootstrap',
          ),
          syncSceneCoverage(
            snapshot.runtimeBatch,
            $frontendState.browserMode.destination,
            'streaming',
          ),
        ]);
      } catch (error) {
        startupError = error instanceof Error ? error.message : String(error);
      }
    })();

    return () => {
      disposed = true;
      dispose();
      assetChannel.dispose();
    };
  });
</script>

<svelte:head>
  <title>Holtburger 3D World Viewer</title>
  <meta
    name="description"
    content="Tauri-backed world viewer for Holtburger 3D with authoritative runtime lifecycle and demand-driven terrain asset loading."
  />
</svelte:head>

<main class="viewer-shell">
  {#if $frontendState.host.boundarySnapshot}
    <WorldDisplay
      activeMode={$frontendState.mode.activeMode}
      activeModeLabel={$frontendState.mode.activeModeLabel}
      hostStatus={$frontendState.host.boundaryStatus}
      runtimeBatch={$frontendState.host.boundarySnapshot?.runtimeBatch ?? null}
      viewModelFeed={$frontendState.host.boundarySnapshot?.viewModelFeed ?? null}
      assetState={$frontendState.asset}
      browserDestination={$frontendState.browserMode.destination}
    />

    <div class="viewer-overlay viewer-overlay--right">
      <BrowserModePage />
    </div>
  {:else}
    <section class="viewer-unavailable">
      <p class="kicker">Tauri Required</p>
      <h1>{startupError ?? 'World viewer failed before startup completed.'}</h1>
      <p class="lede">
        Start the native app to access the live host boundary, terrain asset channel, and authoritative runtime lifecycle.
      </p>
      <pre>{tauriLaunchCommand}</pre>
    </section>
  {/if}
</main>
