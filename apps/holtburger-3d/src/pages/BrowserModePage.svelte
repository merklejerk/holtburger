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
      <p class="kicker">Navigation</p>
      <h2>World browser</h2>
    </div>
    <span class:active={$frontendState.mode.activeMode === 'browser'} class="mode-chip">
      {$frontendState.mode.activeMode === 'browser' ? 'active' : 'standby'}
    </span>
  </header>

  <dl class="data-list compact-data-list">
    <div>
      <dt>Mode</dt>
      <dd>{$frontendState.browserMode.page}</dd>
    </div>
    <div>
      <dt>Anchor</dt>
      <dd>{$frontendState.browserMode.destination?.label ?? $frontendState.host.boundarySnapshot?.runtimeBatch.residency.focusLocationLabel ?? 'unavailable'}</dd>
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
        placeholder="29.90S, 65.90W, 0.0Z"
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
      <p class="kicker">Destination</p>
      <h3>{$frontendState.browserMode.destination.label}</h3>
      <p>
        Source: {$frontendState.browserMode.destination.source}.
      </p>
    </div>
  {/if}
</section>