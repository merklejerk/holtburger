<script lang="ts">
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import {
		EXPLORER_SPAWN_DISTANCE,
		type ExplorerCatalogCapability,
	} from "./explorer-entity-commands";

	interface Props {
		readonly runtimeReady: boolean;
		readonly catalog: ExplorerCatalogCapability | null;
		readonly entities: readonly DynamicEntityView[];
		readonly presentationError: string | null;
		readonly spawn: (wcid: string, distance: number) => Promise<void>;
		readonly despawn: (entity: DynamicEntityView) => Promise<void>;
	}

	let {
		runtimeReady,
		catalog,
		entities,
		presentationError,
		spawn,
		despawn,
	}: Props = $props();
	let wcid = $state("");
	let distance = $state(EXPLORER_SPAWN_DISTANCE.default);
	let pending = $state(false);
	let operationError = $state<string | null>(null);
	let selectedGuid = $state<number | null>(null);
	const selected = $derived(
		entities.find((entity) => entity.identity.guid === selectedGuid) ?? null,
	);
	const catalogReady = $derived(catalog?.status === "available");

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function provenance(): string {
		return catalog?.status === "available"
			? catalog.provenance
			: "catalog unavailable";
	}

	async function submitSpawn(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (pending) return;
		pending = true;
		operationError = null;
		try {
			await spawn(wcid, distance);
		} catch (error) {
			operationError = `WCID ${wcid.trim() || "<empty>"} (${provenance()}): ${errorMessage(error)}`;
		} finally {
			pending = false;
		}
	}

	async function submitDespawn(entity: DynamicEntityView): Promise<void> {
		if (pending) return;
		pending = true;
		operationError = null;
		try {
			await despawn(entity);
		} catch (error) {
			operationError = `${formatGuid(entity.identity.guid)} / WCID ${entity.identity.wcid}: ${errorMessage(error)}`;
		} finally {
			pending = false;
		}
	}

	function formatGuid(guid: number): string {
		return `0x${guid.toString(16).padStart(8, "0")}`;
	}
</script>

<div class="explorer-entities-panel">
	{#if catalog === null}
		<p class="explorer-entities-note">
			Reading offline weenie catalog capability…
		</p>
	{:else if catalog.status === "available"}
		<p class="explorer-entities-note">
			Catalog: {catalog.recordCount.toLocaleString()} records · {catalog.provenance}
		</p>
		<p class="explorer-entities-note truncate" title={catalog.path}>
			{catalog.path}
		</p>
	{:else}
		<p class="explorer-entities-note invalid">WCID spawning unavailable</p>
		<p class="explorer-entities-note">{catalog.reason}</p>
	{/if}

	<form class="explorer-entities-form" onsubmit={submitSpawn}>
		<fieldset
			class="explorer-section"
			disabled={!runtimeReady || !catalogReady || pending}
		>
			<legend>Spawn</legend>
			<div class="explorer-entities-spawn-controls">
				<label class="explorer-form-field">
					<span>WCID</span>
					<input
						class="explorer-control"
						bind:value={wcid}
						placeholder="12345 or 0x3039"
						spellcheck="false"
						autocomplete="off"
					/>
				</label>
				<label class="explorer-form-field">
					<span>Distance</span>
					<input
						class="explorer-control"
						bind:value={distance}
						type="number"
						min={EXPLORER_SPAWN_DISTANCE.minimum}
						step={EXPLORER_SPAWN_DISTANCE.step}
					/>
				</label>
			</div>
			<button class="explorer-action" type="submit">
				{pending ? "Working…" : "Spawn in front"}
			</button>
		</fieldset>
	</form>

	{#if operationError !== null}
		<p class="explorer-entities-note invalid" role="alert">{operationError}</p>
	{/if}
	{#if presentationError !== null}
		<p class="explorer-entities-note invalid" role="alert">
			{presentationError}
		</p>
	{/if}

	<div class="explorer-entities-heading">
		<p class="ac-section-label">Current spawned entities</p>
		<span>{entities.length}</span>
	</div>
	{#if entities.length === 0}
		<p class="explorer-entities-note">No Explorer-spawned entities.</p>
	{:else}
		<ul class="explorer-selectable-list explorer-entities-list">
			{#each entities as entity (entity.identity.guid)}
				<li class="explorer-entities-row">
					<button
						type="button"
						class="explorer-selectable-row"
						class:active={entity.identity.guid === selectedGuid}
						onclick={() => (selectedGuid = entity.identity.guid)}
					>
						<strong>{entity.identity.name}</strong>
						<span
							>{formatGuid(entity.identity.guid)} · WCID {entity.identity
								.wcid}</span
						>
						<span
							>Live gen {entity.generation} · {entity.physics
								.participation}</span
						>
					</button>
					<button
						type="button"
						class="explorer-action"
						disabled={pending}
						onclick={() => submitDespawn(entity)}
					>
						Despawn
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if selected !== null}
		<div class="ac-param-panel">
			<div class="ac-param-row">
				<span class="ac-param-key">Lifecycle</span>
				<code>Live generation {selected.generation}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Physical</span>
				<code>{selected.physics.participation}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Contact</span>
				<code>{selected.placement.contact}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Sampling</span>
				<code>{selected.placement.sampleMode}</code>
			</div>
		</div>
	{/if}
</div>

<style>
	.explorer-entities-panel {
		display: grid;
		gap: 12px;
	}

	.explorer-entities-note {
		margin: 0;
		color: var(--ac-ink-muted);
		font-size: 0.76rem;
		line-height: 1.3;
	}

	.explorer-entities-note.invalid {
		color: #ff9c8f;
	}

	.explorer-entities-note.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.explorer-entities-form {
		display: grid;
		min-width: 0;
	}

	.explorer-entities-spawn-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 7rem);
		gap: 8px;
		align-items: end;
	}

	.explorer-entities-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: baseline;
	}

	.explorer-entities-heading .ac-section-label {
		margin: 0;
	}

	.explorer-entities-heading span {
		color: var(--ac-ink-muted);
		font-size: 0.76rem;
	}

	.explorer-entities-list {
		max-height: 235px;
		overflow: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.explorer-entities-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 6px;
		align-items: center;
	}

	.explorer-entities-row .explorer-selectable-row {
		gap: 2px;
	}

	.explorer-entities-row .explorer-selectable-row span {
		color: var(--ac-ink-muted);
		font-size: 0.75rem;
	}
</style>
