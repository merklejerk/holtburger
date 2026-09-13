<script lang="ts">
	import { onMount, tick } from "svelte";
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import ItemGridStrip from "../app/ItemGridStrip.svelte";
	import ItemIcon from "../app/ItemIcon.svelte";
	import InventoryCurrencyOverlay from "./InventoryCurrencyOverlay.svelte";
	import InventoryEquipmentStrip from "./InventoryEquipmentStrip.svelte";
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
	/** Row hover is local UI state; compatible locations come from sampled world facts. */
	let hoveredEquipmentSlot = $state<number | null>(null);
	let displays = $state<ReadonlyMap<string, ItemIconDisplay>>(new Map());
	/** Footer artwork follows the same bounded display sampling as the inventory cells. */
	const pyrealDisplay = $derived(displays.get(inventory.pyrealIconKey));
	const sections = $derived(view?.sections ?? []);
	const packSlots = $derived(view?.packSlots ?? []);
	const pending = $derived(view?.pending ?? true);
	const sortMode = $derived(view?.sortMode ?? "native");
	const rootDescription = $derived(sections[0]?.container.description);
	const pyreals = $derived(
		rootDescription?.kind === "known" ? rootDescription.pyrealBalance : null,
	);
	const pyrealText = $derived(
		pending || pyreals === null ? "…" : pyreals.toLocaleString(),
	);
	const burden = $derived(
		!pending && rootDescription?.kind === "known"
			? rootDescription.burden
			: null,
	);
	const burdenText = $derived(
		burden === null ? "…" : `${Math.round(burden * 100)}%`,
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
		const pyrealKey = inventory.pyrealIconKey;
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
					for (const row of next.currencies) keys.add(row.iconKey);
					keys.add(pyrealKey);
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
				structure={item.description.kind === "known"
					? item.description.structure
					: null}
				count={item.description.kind === "known"
					? item.description.stackCount
					: null}
				selected={selectedGuid === item.guid}
				dimmed={!pending &&
					hoveredEquipmentSlot !== null &&
					!(
						item.description.kind === "known" &&
						item.description.equipLocations !== null &&
						(item.description.equipLocations & hoveredEquipmentSlot) !== 0
					)}
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
	<aside class="inventory-equipment-strip" aria-label="Equipped items">
		<InventoryEquipmentStrip
			equipment={view?.equipment ?? { rows: [], pending: true }}
			{pending}
			{iconFor}
			{selectedGuid}
			{onSelectItem}
			onHoverSlot={(mask) => {
				hoveredEquipmentSlot = mask;
			}}
		/>
	</aside>
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
		<InventoryCurrencyOverlay
			label={`Total pyreals: ${pyrealText}`}
			rows={view?.currencies ?? []}
			pending={view?.currenciesPending ?? true}
			{displays}
		>
			{#if pyrealDisplay?.kind === "ready" || pyrealDisplay?.kind === "degraded"}
				<span class="inventory-currency-icon"
					><ItemIcon
						display={pyrealDisplay}
						name="Pyreals"
						tooltipLabel="Pyreals"
					/></span
				>
			{:else}
				<ItemIcon
					display={pyrealDisplay}
					name="Pyreals:"
					tooltipLabel="Pyreals"
				/>
			{/if}
			<span>{pyrealText}</span>
		</InventoryCurrencyOverlay>
		<span
			class="inventory-burden"
			role="img"
			aria-label={`Burden: ${burden === null ? "Loading" : burdenText}`}
			title="Burden"
			data-level={burden === null
				? "pending"
				: burden >= 2
					? "overburdened"
					: burden >= 1
						? "burdened"
						: "normal"}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="5" r="3" />
				<path d="M7 8h10l4 13H3Z" />
			</svg>
			<span>{burdenText}</span>
		</span>
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
					structure={index !== 0 && item?.description.kind === "known"
						? item.description.structure
						: null}
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
			grid-template-columns: auto minmax(0, 1fr) auto;
			height: 100%;
			min-height: 0;
			overflow: hidden;
		}
		.inventory-bottom-bar {
			grid-column: 2;
			grid-row: 2;
			display: flex;
			/* Large balances must still fit when the window or theme leaves less room. */
			flex-wrap: wrap;
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
		.inventory-burden {
			display: inline-flex;
			align-items: center;
			gap: 3px;
			color: var(--ui-inventory-burden-normal-color);
		}
		.inventory-burden svg {
			width: 1em;
			height: 1em;
			flex: none;
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
			stroke-linejoin: round;
		}
		.inventory-burden[data-level="burdened"] {
			color: var(--ui-inventory-burden-warning-color);
		}
		.inventory-burden[data-level="overburdened"] {
			color: var(--ui-inventory-burden-danger-color);
		}
		.inventory-currency-icon {
			container: inventory-pyreal-icon / inline-size;
			width: var(--ui-inventory-pyreal-icon-size);
			height: var(--ui-inventory-pyreal-icon-size);
			flex: none;
		}
		.inventory-currency-icon :global(.item-icon) {
			--ui-item-icon-rendering: var(--ui-inventory-pyreal-icon-upsample-filter);
		}
		/* PreparedItemIcon PNGs have a fixed 32px native extent; this compares CSS display sizes. */
		@container inventory-pyreal-icon (width < 32px) {
			.inventory-currency-icon :global(.item-icon) {
				--ui-item-icon-rendering: var(
					--ui-inventory-pyreal-icon-downsample-filter
				);
			}
		}
		.inventory-sort svg {
			width: 18px;
			height: 18px;
		}
		.inventory-sections {
			grid-column: 2;
			grid-row: 1;
			min-width: 0;
			overflow-y: auto;
			padding: var(--ui-inventory-padding);
		}
		.inventory-pack-strip {
			grid-column: 3;
			grid-row: 1 / -1;
			min-height: 0;
			border-left: var(--ui-inventory-divider);
		}
		.inventory-equipment-strip {
			grid-column: 1;
			grid-row: 1 / -1;
			min-height: 0;
			border-right: var(--ui-inventory-divider);
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
