<script lang="ts">
  import { frontendState } from '../app/frontend-state';
</script>

<section class="mode-panel">
  <header class="mode-panel__header">
    <div>
      <p class="kicker">Client mode</p>
      <h2>Deferred gameplay consumer</h2>
    </div>
    <span class:active={$frontendState.mode.activeMode === 'client'} class="mode-chip">
      {$frontendState.mode.activeMode === 'client' ? 'active' : 'standby'}
    </span>
  </header>

  <p>
    Login, character selection, reconnect handling, and in-world gameplay remain intentionally out
    of scope for now. The important Phase 3 change is that client-mode routing is now a frontend
    policy decision derived from lifecycle facts rather than a future host-side page command.
  </p>

  <dl class="data-list compact-data-list">
    <div>
      <dt>Client page</dt>
      <dd>{$frontendState.mode.activeMode === 'client' ? $frontendState.mode.activePageId : 'client-placeholder'}</dd>
    </div>
    <div>
      <dt>Routing reason</dt>
      <dd>{$frontendState.mode.routingReason}</dd>
    </div>
  </dl>
</section>