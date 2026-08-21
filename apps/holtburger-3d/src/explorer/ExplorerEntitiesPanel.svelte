<script lang="ts">
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import {
		EXPLORER_SPAWN_DISTANCE,
		type ExplorerCatalogCapability,
	} from "./explorer-entity-commands";
	import { buildExplorerEntityTree } from "./explorer-entity-tree";
	import {
		MOTION_STYLE,
		type ExplorerPossession,
		type MotionStyleName,
	} from "./explorer-entity-possession";

	interface Props {
		readonly runtimeReady: boolean;
		readonly catalog: ExplorerCatalogCapability | null;
		readonly entities: readonly DynamicEntityView[];
		readonly presentationError: string | null;
		readonly spawn: (wcid: string, distance: number) => Promise<void>;
		readonly despawn: (entity: DynamicEntityView) => Promise<void>;
		/** Possess one entity, or release with `null`. */
		readonly possess: (guid: number | null) => Promise<ExplorerPossession>;
		/** Change the stance the possessed entity holds. */
		readonly setStance: (style: number) => Promise<void>;
		readonly possession: ExplorerPossession | null;
	}

	let {
		runtimeReady,
		catalog,
		entities,
		presentationError,
		spawn,
		despawn,
		possess,
		setStance,
		possession,
	}: Props = $props();
	async function togglePossession(): Promise<void> {
		if (pending || selected === null) return;
		pending = true;
		operationError = null;
		try {
			await possess(selectedIsPossessed ? null : selected.identity.guid);
		} catch (error) {
			operationError = `Possession failed: ${errorMessage(error)}`;
		} finally {
			pending = false;
		}
	}

	async function applyStance(name: MotionStyleName): Promise<void> {
		try {
			await setStance(MOTION_STYLE[name]);
			stance = name;
		} catch (error) {
			operationError = `Stance change failed: ${errorMessage(error)}`;
		}
	}
	let wcid = $state("");
	let distance = $state(EXPLORER_SPAWN_DISTANCE.default);
	let pending = $state(false);
	let operationError = $state<string | null>(null);
	let selectedGuid = $state<number | null>(null);
	const selected = $derived(
		entities.find((entity) => entity.identity.guid === selectedGuid) ?? null,
	);
	let stance = $state<MotionStyleName>("nonCombat");
	$effect(() => {
		if (possession === null || possession.guid === null) return;
		const accepted = (Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
			(name) => MOTION_STYLE[name] === possession.acceptedStance,
		);
		if (accepted !== undefined) stance = accepted;
	});
	const selectedIsPossessed = $derived(
		selectedGuid !== null && selectedGuid === (possession?.guid ?? null),
	);
	const possessedCapability = $derived(
		possession !== null && possession.guid !== null
			? (possession.stances.find(
					(capability) => capability.style === MOTION_STYLE[stance],
				) ?? null)
			: null,
	);
	const catalogReady = $derived(catalog?.status === "available");
	const tree = $derived(buildExplorerEntityTree(entities));

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

{#snippet entityRow(entity: DynamicEntityView, detail: string)}
	<button
		type="button"
		class="explorer-selectable-row"
		class:active={entity.identity.guid === selectedGuid}
		onclick={() => (selectedGuid = entity.identity.guid)}
	>
		<strong>{entity.identity.name}</strong>
		<span>{formatGuid(entity.identity.guid)} · WCID {entity.identity.wcid}</span
		>
		<span>{detail}</span>
	</button>
{/snippet}

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
			{#each tree.roots as root (root.entity.identity.guid)}
				<li class="explorer-entities-node">
					<div class="explorer-entities-row">
						{@render entityRow(
							root.entity,
							`Live gen ${root.entity.generation} · ${root.entity.physics.participation}`,
						)}
						<!-- Despawn is a wearer-level operation: the host retires a wearer and its
						complete child set in one generation, and refuses an independent child. -->
						<button
							type="button"
							class="emoji-button explorer-entities-despawn"
							aria-label={`Despawn ${root.entity.identity.name}`}
							title="Despawn this entity and its held items"
							disabled={pending}
							onclick={() => submitDespawn(root.entity)}
						>
							🗑️
						</button>
					</div>
					{#if root.children.length > 0}
						<ul class="explorer-entities-children">
							{#each root.children as child (child.identity.guid)}
								<li class="explorer-entities-child">
									{@render entityRow(
										child,
										`${child.placement.parentLocation} · ${child.placement.placement}`,
									)}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
		{#if tree.orphans.length > 0}
			<p class="explorer-entities-note invalid" role="alert">
				{tree.orphans.length} held item(s) reference a wearer absent from this feed
				generation, which the host publishes atomically.
			</p>
			<ul class="explorer-selectable-list explorer-entities-list">
				{#each tree.orphans as orphan (orphan.identity.guid)}
					<li class="explorer-entities-node explorer-entities-orphan">
						{@render entityRow(
							orphan,
							`Missing wearer ${formatGuid(orphan.placement.parent)}`,
						)}
					</li>
				{/each}
			</ul>
		{/if}
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
			{#if selected.placement.kind === "world"}
				<div class="ac-param-row">
					<span class="ac-param-key">Contact</span>
					<code>{selected.placement.contact}</code>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Sampling</span>
					<code>{selected.placement.sampleMode}</code>
				</div>
			{:else}
				<div class="ac-param-row">
					<span class="ac-param-key">Attached to</span>
					<code>{formatGuid(selected.placement.parent)}</code>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Holding pose</span>
					<code
						>{selected.placement.parentLocation} · {selected.placement
							.placement}</code
					>
				</div>
			{/if}

			<div class="ac-param-row">
				<span class="ac-param-key">Possession</span>
				<button
					type="button"
					disabled={!runtimeReady || pending}
					onclick={togglePossession}
				>
					{selectedIsPossessed ? "Release" : "Possess"}
				</button>
			</div>

			{#if selectedIsPossessed && possession !== null && possession.guid !== null}
				<div class="ac-param-row">
					<span class="ac-param-key">Motion table</span>
					<code>{possession.motionTableId}</code>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Control sources</span>
					<code>
						{#if possessedCapability === null}
							unmodelled stance
						{:else}
							walk {possessedCapability.walk} · run {possessedCapability.run} · side
							{possessedCapability.sidestep} · turn {possessedCapability.turn}
						{/if}
					</code>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Stance</span>
					<select
						value={stance}
						onchange={(event) =>
							applyStance(event.currentTarget.value as MotionStyleName)}
					>
						{#each Object.keys(MOTION_STYLE) as name (name)}
							{#if possession.stances.some((capability) => capability.style === MOTION_STYLE[name as MotionStyleName])}
								<option value={name}>{name}</option>
							{/if}
						{/each}
					</select>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.explorer-entities-panel {
		display: grid;
		gap: 12px;
		/* One gap governs sibling spacing and the connector bridge; they must not drift apart. */
		--entities-tree-gap: 4px;
		/* Breathing room between the row action and the row edge, reused as its text-side gutter. */
		--entities-action-inset: 9px;
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

	/*
	 * The action sits inside the row's own box rather than beside it, so a wearer reads as one
	 * object carrying one control. It overlays the selectable button because the two cannot nest.
	 */
	.explorer-entities-row {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.explorer-entities-despawn {
		position: absolute;
		top: var(--entities-action-inset);
		right: var(--entities-action-inset);
	}

	/* Clear the action's footprint: its 32px width plus one inset on each side of it. */
	.explorer-entities-row .explorer-selectable-row {
		padding-right: calc(32px + var(--entities-action-inset) * 2);
	}

	/* Every row kind — wearer, held child, and orphan — descends from a node. */
	.explorer-entities-node .explorer-selectable-row {
		gap: 2px;
	}

	.explorer-entities-node .explorer-selectable-row span {
		color: var(--ac-ink-muted);
		font-size: 0.75rem;
	}

	.explorer-entities-node {
		display: grid;
		/* minmax(0, …) so a long name shrinks the row instead of overflowing the 420px dock. */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--entities-tree-gap);
	}

	.explorer-entities-children {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--entities-tree-gap);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/*
	 * File-tree chrome drawn per child rather than on the list, so the trunk can stop at the last
	 * elbow instead of running past it. Offsets are proportional because rows are two or three
	 * lines tall depending on the entity, and the trunk is lifted by exactly the sibling gap so it
	 * reads continuous between rows. The rule colour matches the selectable-row border.
	 */
	.explorer-entities-child {
		position: relative;
		/* A button shrink-to-fits unless it is a stretched grid item, so the row must be a grid
		   for a held item to span the same width as its wearer. */
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		padding-left: 15px;
	}

	.explorer-entities-child::before {
		content: "";
		position: absolute;
		top: calc(-1 * var(--entities-tree-gap));
		bottom: 0;
		left: 4px;
		border-left: 1px solid rgb(162 117 33 / 45%);
	}

	.explorer-entities-child:last-child::before {
		bottom: auto;
		height: calc(50% + var(--entities-tree-gap));
	}

	.explorer-entities-child::after {
		content: "";
		position: absolute;
		top: 50%;
		left: 4px;
		width: 7px;
		border-top: 1px solid rgb(162 117 33 / 45%);
	}

	/* An orphan hangs from nothing, so it carries a broken-state border rather than a connector. */
	.explorer-entities-orphan .explorer-selectable-row {
		border-color: #ff9c8f;
	}
</style>
