<script lang="ts">
  import { appShellState, availableModes, selectedModeLabel } from './app/state';
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
</script>

<svelte:head>
  <title>Holtburger 3D Phase 0</title>
  <meta
    name="description"
    content="Phase 0 scaffold for the Holtburger 3D app shell, Tauri host, and contract worksheet."
  />
</svelte:head>

<main class="shell">
  <section class="hero">
    <p class="eyebrow">Phase 0</p>
    <h1>Holtburger 3D Scaffold</h1>
    <p class="lede">
      This app root establishes the planned frontend and host shape without committing to gameplay
      flow or renderer details too early.
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
      <p class="kicker">Phase 0 contracts</p>
      <h2>Contract worksheet anchors</h2>
      <ul>
        {#each contractAreas as area}
          <li>{area}</li>
        {/each}
      </ul>
    </article>

    <article class="panel panel-world">
      <p class="kicker">Shared foundation</p>
      <WorldDisplay
        modeLabel={selectedModeLabel}
        status="Placeholder world shell"
        detail="Shared world-facing infrastructure starts here; browser mode is the first planned consumer."
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
