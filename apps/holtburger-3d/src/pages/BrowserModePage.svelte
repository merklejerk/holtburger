<script lang="ts">
  import { frontendState } from '../app/frontend-state';

  function handleDraftInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    frontendState.updateBrowserDraft(input.value);
  }

  function previewDestination(): void {
    frontendState.previewBrowserLocation();
  }

  function useCurrentRuntimeResidency(): void {
    frontendState.useRuntimeResidencyDestination();
  }
</script>

<section class="mode-panel">
  <header class="mode-panel__header">
    <div>
      <p class="kicker">Browser mode</p>
      <h2>First consumer of the shared world shell</h2>
    </div>
    <span class:active={$frontendState.mode.activeMode === 'browser'} class="mode-chip">
      {$frontendState.mode.activeMode === 'browser' ? 'active' : 'standby'}
    </span>
  </header>

  <p>
    Browser mode now owns the first coordinate-driven location flow. The current runtime residency
    is available as a frontend-selected destination, and the selected destination now feeds the
    shared WorldDisplay shell below without leaking browser policy back into the host boundary.
  </p>

  <dl class="data-list compact-data-list">
    <div>
      <dt>Browser page</dt>
      <dd>{$frontendState.browserMode.page}</dd>
    </div>
    <div>
      <dt>Runtime anchor</dt>
      <dd>{$frontendState.host.boundarySnapshot?.runtimeBatch.residency.focusLocationLabel ?? 'unavailable'}</dd>
    </div>
  </dl>

  <form class="browser-form" on:submit|preventDefault={previewDestination}>
    <label class="browser-form__field" for="browser-location-input">
      <span>Location input</span>
      <input
        id="browser-location-input"
        type="text"
        value={$frontendState.browserMode.draftInput}
        on:input={handleDraftInput}
        placeholder="100.40S, 101.55W, 1.0Z"
        spellcheck="false"
      />
    </label>

    <div class="browser-form__actions">
      <button type="submit">Preview destination</button>
      <button
        type="button"
        on:click={useCurrentRuntimeResidency}
        disabled={!$frontendState.host.boundarySnapshot}
      >
        Use current residency
      </button>
    </div>
  </form>

  {#if $frontendState.browserMode.validationMessage}
    <p class="validation-message">{$frontendState.browserMode.validationMessage}</p>
  {/if}

  {#if $frontendState.browserMode.destination}
    <div class="destination-preview">
      <p class="kicker">Destination preview</p>
      <h3>{$frontendState.browserMode.destination.label}</h3>
      <p>
        Source: {$frontendState.browserMode.destination.source}. Frontend routing keeps browser mode
        active while this preview is selected.
      </p>
    </div>
  {/if}
</section>