<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { frontendState } from './app/frontend-state';
  import {
    AssetChannelController,
    createTerrainCoverageRequests,
  } from './lib/assets/asset-channel';
  import {
    listenForRuntimeLifecycle,
    readHostBoundarySnapshot,
  } from './lib/host/tauri';
  import type { AssetPriority, RuntimeBatchDto } from './lib/host/contracts';
  import WorldDisplay from './lib/world-display/WorldDisplay.svelte';
  import BrowserModePage from './pages/BrowserModePage.svelte';

  onMount(() => {
    let dispose = () => {};
    let disposed = false;
    const assetChannel = new AssetChannelController();
    const inFlightTerrainAssetIds = new Set<string>();

    async function syncTerrainCoverage(
      runtimeBatch: RuntimeBatchDto | null,
      browserDestination: typeof $frontendState.browserMode.destination,
      priority: AssetPriority,
    ): Promise<void> {
      const assetState = get(frontendState).asset;
      const requests = createTerrainCoverageRequests(
        runtimeBatch,
        browserDestination,
        priority,
        assetState.preparedByAssetId,
        [...inFlightTerrainAssetIds],
      );

      if (requests.length === 0) {
        return;
      }

      await Promise.allSettled(
        requests.map(async (request) => {
          inFlightTerrainAssetIds.add(request.assetId);
          frontendState.markAssetPending(request);

          try {
            const preparedAsset = await assetChannel.prepareAsset(request);
            if (!disposed) {
              frontendState.applyPreparedAsset(preparedAsset);
            }
          } catch (error) {
            if (!disposed) {
              frontendState.applyAssetError(
                request,
                error instanceof Error ? error.message : String(error),
              );
            }
          } finally {
            inFlightTerrainAssetIds.delete(request.assetId);
          }
        }),
      );
    }

    void (async () => {
      dispose = await listenForRuntimeLifecycle((notification) => {
        frontendState.applyRuntimeNotification(notification);
        if (notification.runtimeBatch) {
          void syncTerrainCoverage(
            notification.runtimeBatch,
            $frontendState.browserMode.destination,
            'streaming',
          );
        }
      });

      const snapshot = await readHostBoundarySnapshot();
      frontendState.loadSnapshot(snapshot);
      await Promise.all([
        syncTerrainCoverage(
          snapshot.runtimeBatch,
          $frontendState.browserMode.destination,
          'bootstrap',
        ),
        syncTerrainCoverage(
          snapshot.runtimeBatch,
          $frontendState.browserMode.destination,
          'streaming',
        ),
      ]);
    })();

    return () => {
      disposed = true;
      dispose();
      assetChannel.dispose();
    };
  });
</script>

<svelte:head>
  <title>Holtburger 3D World Browser Foundation</title>
  <meta
    name="description"
    content="World-browser foundation for Holtburger 3D, with typed lifecycle, authoritative runtime, and demand-driven asset contracts behind a shared world shell."
  />
</svelte:head>

<main class="viewer-shell">
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
</main>
