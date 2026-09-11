<script lang="ts">
	import { onMount, tick } from "svelte";
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import ItemGridStrip from "../app/ItemGridStrip.svelte";
	import ItemIcon from "../app/ItemIcon.svelte";
	import type { ItemIconDisplay } from "../app/item-icon-repository";
	import type { ClientEntityFacts } from "./client-entity-mirror";
	import type {
		ClientInventoryState,
		ClientInventoryView,
	} from "./client-inventory-state";
	import { nextInventorySortMode } from "./client-inventory-sections";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Stable session owner; the parent keys this component by that lifetime. */
		readonly inventory: ClientInventoryState;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
	}
	const { inventory, selectedGuid, onSelectItem }: Props = $props();
	let view = $state<ClientInventoryView | null>(null);
	let displays = $state<ReadonlyMap<string, ItemIconDisplay>>(new Map());
	const sections = $derived(view?.sections ?? []);
	const packSlots = $derived(view?.packSlots ?? []);
	const pending = $derived(view?.pending ?? true);
	const sortMode = $derived(view?.sortMode ?? "native");
	const rootDescription = $derived(sections[0]?.container.description);
	const pyreals = $derived(
		rootDescription?.kind === "known" ? rootDescription.pyrealBalance : null,
	);
	const sortLabels = {
		native: "Native (slot index)",
		alphabetical: "Alphabetical",
		"item-type": "Item type",
	};
	let contents = $state<HTMLDivElement | null>(null);
	let sampleNow: (() => void) | null = null;

	onMount(() => {
		const repository = inventory.icons;
		const owner = repository.createOwner("display");
		let lastView: ClientInventoryView | null = null;
		let lastRevision = -1;
		let displayedKeys = new Set<string>();
		let disposed = false;
		let sampling = false;
		let resample = false;
		const sample = async () => {
			if (disposed) return;
			if (sampling) {
				resample = true;
				return;
			}
			sampling = true;
			try {
				do {
					resample = false;
					const next = inventory.read();
					const revision = repository.revision;
					if (next === lastView && revision === lastRevision) break;
					const keys = new Set(next.iconKeys.values());
					for (const key of keys) repository.retainKey(owner, key);
					const images = new Map(
						[...keys].map((key) => [key, repository.read(key)]),
					);
					lastView = next;
					lastRevision = revision;
					view = next;
					displays = images;
					// New leases exist before publication; old URLs survive the DOM commit.
					await tick();
					for (const key of displayedKeys)
						if (!keys.has(key)) repository.release(owner, key);
					displayedKeys = keys;
				} while (resample && !disposed);
			} finally {
				sampling = false;
			}
		};
		sampleNow = () => {
			void sample();
		};
		sampleNow();
		const timer = window.setInterval(
			sampleNow,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => {
			disposed = true;
			sampleNow = null;
			window.clearInterval(timer);
			// This is only the display-use guard; persistent model references survive closing.
			void tick().then(() => repository.releaseOwner(owner));
		};
	});

	function iconFor(guid: number): ItemIconDisplay | undefined {
		const key = view?.iconKeys.get(guid);
		return key === undefined ? undefined : displays.get(key);
	}
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
				count={item.description.kind === "known"
					? item.description.stackCount
					: null}
				selected={selectedGuid === item.guid}
				disabled={pending || item.description.kind === "pending"}
				onselect={() => onSelectItem(item.guid)}
			>
				{#snippet visual(tooltipLabel: string)}<ItemIcon
						{tooltipLabel}
						display={iconFor(item.guid)}
						name={itemName(item)}
					/>{/snippet}
			</ItemGridCell>
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
		{#each sections as section (section.container.guid)}
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
			title={`Sort: ${sortLabels[sortMode]}. Click for ${sortLabels[nextInventorySortMode(sortMode)]}.`}
			onclick={() => {
				inventory.cycleSort();
				sampleNow?.();
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
					count={index !== 0 && item?.description.kind === "known"
						? item.description.stackCount
						: null}
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
				>
					{#snippet visual(tooltipLabel: string)}
						<ItemIcon
							{tooltipLabel}
							display={item === null ? undefined : iconFor(item.guid)}
							name={index === 0
								? "Main Pack"
								: item === null
									? ""
									: itemName(item)}
						/>
					{/snippet}
				</ItemGridCell>
			{/each}
		</ItemGridStrip>
	</aside>
</div>

<style>
	@layer components {
		.client-inventory {
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			grid-template-columns: minmax(0, 1fr) auto;
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
			padding: 4px var(--ui-inventory-padding);
			border-top: var(--ui-inventory-divider);
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
			padding: var(--ui-inventory-padding);
		}
		.inventory-pack-strip {
			grid-column: 2;
			grid-row: 1 / -1;
			min-height: 0;
			border-left: var(--ui-inventory-divider);
		}

		section + section {
			margin-top: var(--ui-inventory-section-gap);
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
				minmax(min(100%, var(--ui-item-cell-min-size)), 1fr)
			);
			gap: var(--ui-item-grid-gap);
			margin-bottom: 8px;
		}
		.inventory-header {
			width: 100%;
			text-align: left;
			overflow-wrap: anywhere;
		}
	}
</style>
