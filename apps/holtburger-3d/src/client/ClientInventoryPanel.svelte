<script lang="ts">
	import { onMount } from "svelte";
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import ItemGridStrip from "../app/ItemGridStrip.svelte";
	import type {
		ClientEntityFacts,
		ClientEntityRead,
	} from "./client-entity-mirror";
	import {
		clientInventorySections,
		clientInventoryPackSlots,
		sortInventoryItems,
		type InventorySortMode,
		type ClientInventorySection,
	} from "./client-inventory-sections";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Session-owned facts sampled only at this mounted consumer's cadence. */
		readonly readEntities: () => ClientEntityRead;
		/** Existing selection identity, shared with viewport and minimap. */
		readonly selectedGuid: number | null;
		/** Controller rechecks admission against current facts at the click edge. */
		readonly onSelectItem: (guid: number) => void;
	}
	const { readEntities, selectedGuid, onSelectItem }: Props = $props();
	let sections = $state<readonly ClientInventorySection[]>([]);
	let packSlots = $state<readonly (ClientEntityFacts | null)[]>([]);
	let pending = $state(true);
	let sortMode = $state<InventorySortMode>("native");
	const sortLabels = {
		native: "Native (slot index)",
		alphabetical: "Alphabetical",
		"item-type": "Item type",
	};
	const nextSort = {
		native: "alphabetical",
		alphabetical: "item-type",
		"item-type": "native",
	} as const;
	const sortedSections = $derived(
		sections.map((section) => ({
			...section,
			items: sortInventoryItems(section.items, sortMode),
			packs: sortInventoryItems(section.packs, sortMode),
			unslotted: sortInventoryItems(section.unslotted, sortMode),
		})),
	);
	const rootDescription = $derived(sections[0]?.container.description);
	const pyreals = $derived(
		rootDescription?.kind === "known" ? rootDescription.pyrealBalance : null,
	);
	let revision: number | null = null;
	let contents = $state<HTMLDivElement | null>(null);

	onMount(() => {
		const sample = () => {
			const read = readEntities();
			pending = read.kind === "pending";
			if (read.kind === "pending" || read.level.revision === revision) return;
			sections = clientInventorySections(read.level);
			packSlots = clientInventoryPackSlots(read.level);
			revision = read.level.revision;
		};
		sample();
		const timer = window.setInterval(
			sample,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => window.clearInterval(timer);
	});

	function selectPack(guid: number): void {
		onSelectItem(guid);
		const section = contents?.querySelector<HTMLElement>(
			`[data-container-guid="${guid}"]`,
		);
		// Foci occupy pack slots but have no contents section to scroll to.
		if (contents === null || section === null || section === undefined) return;
		const inset = Number.parseFloat(getComputedStyle(contents).paddingTop);
		// Scroll only this pane; the browser clamps targets beyond its available runway.
		contents.scrollTop +=
			section.getBoundingClientRect().top -
			contents.getBoundingClientRect().top -
			contents.clientTop -
			inset;
	}

	function itemName(item: ClientEntityFacts): string {
		return item.description.kind === "known"
			? item.description.name
			: "Loading item…";
	}
</script>

{#snippet cells(items: readonly ClientEntityFacts[])}
	<div class="inventory-grid">
		{#each items as item (item.guid)}
			<ItemGridCell
				itemGuid={item.guid}
				label={itemName(item)}
				selected={selectedGuid === item.guid}
				disabled={pending || item.description.kind === "pending"}
				onselect={() => onSelectItem(item.guid)}
			/>
		{/each}
	</div>
{/snippet}

<div
	class="client-inventory"
	aria-label="Inventory contents"
	aria-busy={pending}
>
	<div class="inventory-sections" bind:this={contents}>
		{#if pending}<p role="status">Updating inventory…</p>{/if}
		{#each sortedSections as section (section.container.guid)}
			<section
				data-container-guid={section.container.guid}
				aria-label={section.mainPack
					? "Main Pack"
					: itemName(section.container)}
			>
				<h3>
					<button
						type="button"
						class="inventory-header ui-item-selection ui-hud-button"
						data-item-guid={section.container.guid}
						aria-pressed={selectedGuid === section.container.guid}
						disabled={pending ||
							section.container.description.kind === "pending"}
						onclick={() => onSelectItem(section.container.guid)}
					>
						{section.mainPack ? "Main Pack" : itemName(section.container)}
						({section.items.length} / {section.container.storage.kind ===
						"container"
							? (section.container.storage.itemCapacity ?? "?")
							: "?"})
					</button>
				</h3>
				{@render cells(section.items)}
				{#if section.packs.length > 0}
					<h4>Pack slots</h4>
					{@render cells(section.packs)}
				{/if}
				{#if section.unslotted.length > 0}
					<h4>Awaiting placement</h4>
					{@render cells(section.unslotted)}
				{/if}
				{#if section.container.storage.kind === "container" && section.container.storage.roster === "awaiting"}
					<p>Loading contents…</p>
				{:else if section.items.length + section.packs.length + section.unslotted.length === 0}
					<p>Empty</p>
				{/if}
			</section>
		{/each}
	</div>
	<div class="inventory-bottom-bar" aria-label="Inventory summary">
		<span aria-label="Total pyreals"
			>Pyreals: {pending || pyreals === null
				? "…"
				: pyreals.toLocaleString()}</span
		>
		<button
			type="button"
			class="ui-hud-button inventory-sort"
			aria-label={`Sort inventory: ${sortLabels[sortMode]}`}
			title={`Sort: ${sortLabels[sortMode]}. Click for ${sortLabels[nextSort[sortMode]]}.`}
			onclick={() => {
				sortMode = nextSort[sortMode];
			}}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path
					d="M5 4v16m-3-3 3 3 3-3M11 5h10M11 10h7M11 15h4"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				/></svg
			>
			<span aria-hidden="true"
				>{sortMode === "native"
					? "#"
					: sortMode === "alphabetical"
						? "A"
						: "T"}</span
			>
		</button>
	</div>
	<aside class="inventory-pack-strip" aria-label="Inventory containers">
		<ItemGridStrip>
			{#each packSlots as item, index (index)}
				<ItemGridCell
					itemGuid={item?.guid ?? null}
					label={index === 0
						? "Main Pack"
						: item === null
							? "Empty pack slot"
							: itemName(item)}
					selected={item !== null && selectedGuid === item.guid}
					disabled={pending ||
						item === null ||
						item.description.kind === "pending"}
					onselect={() => {
						if (item !== null) selectPack(item.guid);
					}}
				/>
			{/each}
		</ItemGridStrip>
	</aside>
</div>

<style>
	@layer components {
		.client-inventory {
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			grid-template-columns: minmax(0, 1fr) var(
					--ui-inventory-strip-width,
					68px
				);
			height: 100%;
			min-height: 0;
			overflow: hidden;
		}
		.inventory-bottom-bar {
			grid-column: 1;
			grid-row: 2;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 4px var(--ui-inventory-padding, 10px);
			border-top: var(--ui-inventory-divider, 1px solid currentColor);
			white-space: nowrap;
		}
		.inventory-sort {
			display: flex;
			align-items: center;
			gap: 3px;
		}
		.inventory-sort svg {
			width: 18px;
			height: 18px;
		}
		.inventory-sections {
			min-width: 0;
			overflow-y: auto;
			padding: var(--ui-inventory-padding, 10px);
		}
		.inventory-pack-strip {
			grid-column: 2;
			grid-row: 1 / -1;
			min-height: 0;
			border-left: var(--ui-inventory-divider, 1px solid currentColor);
		}

		section + section {
			margin-top: var(--ui-inventory-section-gap, 14px);
		}
		h3,
		h4,
		p {
			margin: 0 0 8px;
		}
		h4,
		p {
			font-size: 0.85rem;
		}
		.inventory-grid {
			display: grid;
			grid-template-columns: repeat(
				auto-fill,
				minmax(min(100%, var(--ui-item-cell-min-size, 56px)), 1fr)
			);
			gap: var(--ui-item-grid-gap, 5px);
			margin-bottom: 8px;
		}
		.inventory-header {
			width: 100%;
			text-align: left;
			overflow-wrap: anywhere;
		}
	}
</style>
