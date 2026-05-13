<script lang="ts">
  import { frontendState } from '../app/frontend-state';
  import type { BrowserLocationSelection } from '../app/browser-mode';
  import type { AppModeId } from '../app/modes';
  import type { AssetChannelState } from '../lib/assets/types';
  import type { FrontendStateFeedDto, RuntimeBatchDto } from '../lib/host/contracts';
  import WorldDisplay from '../lib/world-display/WorldDisplay.svelte';
  import { normalizeViewportPoint } from '../lib/world-display/model';

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

  let rootElement = $state<HTMLDivElement | null>(null);
  let worldDisplay = $state<WorldDisplay | null>(null);

  function handleBrowserClickCapture(event: MouseEvent): void {
    if (!event.ctrlKey || !rootElement || !worldDisplay) {
      return;
    }

    const rect = rootElement.getBoundingClientRect();
    const viewportPoint = normalizeViewportPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
    const landblockId =
      worldDisplay.pickTerrainLandblockAtViewportPoint(viewportPoint);

    if (landblockId === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    frontendState.selectBrowserLandblockDestination(landblockId);
  }
</script>

<div
  bind:this={rootElement}
  class="browser-world-display"
  onclickcapture={handleBrowserClickCapture}
>
  <WorldDisplay
    bind:this={worldDisplay}
    activeMode={activeMode}
    activeModeLabel={activeModeLabel}
    hostStatus={hostStatus}
    runtimeBatch={runtimeBatch}
    viewModelFeed={viewModelFeed}
    assetState={assetState}
    browserDestination={browserDestination}
    landblockCoverageRadius={landblockCoverageRadius}
  />
</div>
