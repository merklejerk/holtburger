<script lang="ts">
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import type { ExplorerCatalogCapability } from "./explorer-entity-commands";

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
	let distance = $state(5);
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

<section class="entities-panel" aria-label="Explorer entities">
	{#if catalog === null}
		<p class="catalog-state">Reading offline weenie catalog capability…</p>
	{:else if catalog.status === "available"}
		<p class="catalog-state">
			Catalog: {catalog.recordCount.toLocaleString()} records · {catalog.provenance}
		</p>
		<p class="catalog-path" title={catalog.path}>{catalog.path}</p>
	{:else}
		<p class="catalog-state unavailable">WCID spawning unavailable</p>
		<p class="catalog-reason">{catalog.reason}</p>
	{/if}

	<form onsubmit={submitSpawn}>
		<label>
			<span>WCID</span>
			<input
				bind:value={wcid}
				placeholder="12345 or 0x3039"
				spellcheck="false"
				autocomplete="off"
			/>
		</label>
		<label>
			<span>Distance</span>
			<input bind:value={distance} type="number" min="0.1" step="0.5" />
		</label>
		<button
			type="submit"
			disabled={!runtimeReady || !catalogReady || pending}
		>
			{pending ? "Working…" : "Spawn in front"}
		</button>
	</form>

	{#if operationError !== null}
		<p class="entity-error" role="alert">{operationError}</p>
	{/if}
	{#if presentationError !== null}
		<p class="entity-error" role="alert">{presentationError}</p>
	{/if}

	<div class="entity-list-heading">
		<span>Current spawned entities</span>
		<span>{entities.length}</span>
	</div>
	{#if entities.length === 0}
		<p class="empty">No Explorer-spawned entities.</p>
	{:else}
		<ul class="entity-list">
			{#each entities as entity (entity.identity.guid)}
				<li class:selected={entity.identity.guid === selectedGuid}>
					<button
						type="button"
						class="entity-select"
						onclick={() => (selectedGuid = entity.identity.guid)}
					>
						<strong>{entity.identity.name}</strong>
						<span>{formatGuid(entity.identity.guid)} · WCID {entity.identity.wcid}</span>
						<span>Live gen {entity.generation} · {entity.physics.participation}</span>
					</button>
					<button
						type="button"
						class="despawn"
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
		<dl class="entity-details">
			<div><dt>Lifecycle</dt><dd>Live generation {selected.generation}</dd></div>
			<div><dt>Physical</dt><dd>{selected.physics.participation}</dd></div>
			<div><dt>Contact</dt><dd>{selected.placement.contact}</dd></div>
			<div><dt>Sampling</dt><dd>{selected.placement.sampleMode}</dd></div>
		</dl>
	{/if}
</section>

<style>
	.entities-panel,
	form,
	label,
	.entity-select {
		display: flex;
		flex-direction: column;
	}

	.entities-panel,
	form {
		gap: 0.6rem;
	}

	.catalog-state,
	.catalog-path,
	.catalog-reason,
	.entity-error,
	.empty {
		margin: 0;
	}

	.catalog-path,
	.catalog-reason,
	.entity-select span,
	.empty,
	dt {
		font-size: 0.75rem;
		opacity: 0.75;
	}

	.catalog-path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.unavailable,
	.entity-error {
		color: #ffb4a8;
	}

	label {
		gap: 0.2rem;
		font-size: 0.75rem;
	}

	input,
	button {
		font: inherit;
	}

	.entity-list-heading {
		display: flex;
		justify-content: space-between;
		border-bottom: 1px solid rgb(255 255 255 / 16%);
		padding-bottom: 0.25rem;
	}

	.entity-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.entity-list li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.35rem;
		padding: 0.35rem;
		border: 1px solid transparent;
	}

	.entity-list li.selected {
		border-color: rgb(255 255 255 / 35%);
	}

	.entity-select {
		align-items: flex-start;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
	}

	.despawn {
		align-self: center;
	}

	.entity-details {
		margin: 0;
	}

	.entity-details div {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}

	dd {
		margin: 0;
		text-align: right;
	}
</style>
