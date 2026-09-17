<script lang="ts">
	import { bindContentsActivation } from "./client-contents-activation";
	import type { ClientItemInteractions } from "./client-item-interactions";
	import { onMount } from "svelte";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import InventorySplitDialog from "./InventorySplitDialog.svelte";
	import {
		ClientInventorySplit,
		type InventorySplitRequest,
	} from "./client-inventory-split";

	import ClientContentsView from "./ClientContentsView.svelte";

	import UiIcon from "../app/UiIcon.svelte";
	import InventoryCurrencyOverlay from "./InventoryCurrencyOverlay.svelte";
	import InventoryEquipmentStrip from "./InventoryEquipmentStrip.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";

	import type {
		ClientInventoryState,
		ClientInventoryView,
	} from "./client-inventory-state";
	import ClientContentsSortButton from "./ClientContentsSortButton.svelte";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Stable session owner; the parent keys this component by that lifetime. */
		readonly inventory: ClientInventoryState;
		/** Shared source activation and target acquisition. */
		readonly interactions: ClientItemInteractions;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
	}
	const { inventory, interactions, selectedGuid, onSelectItem }: Props =
		$props();
	let view = $state<ClientInventoryView | null>(null);
	/** Row hover is local UI state; compatible locations come from sampled world facts. */
	let hoveredEquipmentSlot = $state<number | null>(null);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	/** Footer artwork follows the same bounded display sampling as the inventory cells. */
	const pyrealDisplay = $derived(displays.get(inventory.pyrealIconKey));
	const sections = $derived(view?.sections ?? []);
	const capacities = $derived<ClientInventoryView["capacities"]>(
		view?.capacities ?? new Map(),
	);
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
	let panel: HTMLDivElement;

	let sampleNow: (() => void) | null = null;
	/** Cold dialog state only; execution remains owned by core. */
	let splitRequest = $state<InventorySplitRequest | null>(null);
	let splitOwner: ClientInventorySplit | null = null;

	onMount(() =>
		bindContentsActivation(
			panel,
			".item-grid-cell[data-item-guid]:not(:disabled)",
			interactions,
			() => selectedGuid,
			onSelectItem,
			(guid) => interactions.use(guid, false),
		),
	);
	onMount(() => {
		const split = new ClientInventorySplit(panel, inventory, (request) => {
			splitRequest = request;
		});
		splitOwner = split;
		const display = startUiIconDisplay({
			repository: inventory.icons,
			intervalMs: CLIENT_TUNING.inventory.displayIntervalMs,
			read: () => inventory.read(),
			keys: (next) => [
				...next.iconKeys.values(),
				...next.currencies.map((row) => row.iconKey),
				inventory.pyrealIconKey,
			],
			publish: (next, images) => {
				view = next;
				displays = images;
			},
		});
		sampleNow = display.refresh;
		return () => {
			split.destroy();
			splitOwner = null;
			sampleNow = null;
			display.destroy();
		};
	});

	function iconFor(guid: number): UiIconDisplay | undefined {
		const key = view?.iconKeys.get(guid);
		return key === undefined ? undefined : displays.get(key);
	}
	function selectItem(guid: number): boolean {
		const targeting = interactions.snapshot();
		if (targeting.kind === "acquiring") {
			interactions.target(guid, targeting.generation);
			return false;
		}
		onSelectItem(guid);
		return true;
	}
</script>

<div
	bind:this={panel}
	class="client-inventory"
	aria-label="Inventory contents"
	aria-busy={pending}
>
	<div class="inventory-layout" inert={splitRequest !== null}>
		<aside class="inventory-equipment-strip" aria-label="Equipped items">
			<InventoryEquipmentStrip
				{capacities}
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
		<ClientContentsView
			{sections}
			packs={packSlots}
			{pending}
			orientation="vertical"
			{selectedGuid}
			{capacities}
			{iconFor}
			onSelectItem={selectItem}
			rootLabel="Main Pack"
			dimItem={(item) =>
				!pending &&
				hoveredEquipmentSlot !== null &&
				!(
					item.description.kind === "known" &&
					item.description.equipLocations !== null &&
					(item.description.equipLocations & hoveredEquipmentSlot) !== 0
				)}
		>
			{#snippet footer()}
				<div class="inventory-bottom-bar" aria-label="Inventory summary">
					<InventoryCurrencyOverlay
						label={`Total pyreals: ${pyrealText}`}
						rows={view?.currencies ?? []}
						pending={view?.currenciesPending ?? true}
						{displays}
					>
						{#if pyrealDisplay?.kind === "ready" || pyrealDisplay?.kind === "degraded"}
							<span class="inventory-currency-icon"
								><UiIcon
									display={pyrealDisplay}
									name="Pyreals"
									tooltipLabel="Pyreals"
								/></span
							>
						{:else}
							<UiIcon
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
					<ClientContentsSortButton
						mode={sortMode}
						label="inventory"
						onclick={() => {
							inventory.cycleSort();
							sampleNow?.();
						}}
					/>
				</div>
			{/snippet}
		</ClientContentsView>
	</div>
	{#if splitRequest !== null}
		<InventorySplitDialog
			request={splitRequest}
			onSubmit={(amount) => splitOwner?.submit(amount)}
			onCancel={() => splitOwner?.close()}
		/>
	{/if}
</div>

<style>
	@layer components {
		.inventory-layout {
			display: contents;
		}
		.client-inventory {
			position: relative;
			display: grid;
			grid-template-rows: minmax(0, 1fr);
			grid-template-columns: auto minmax(0, 1fr);
			height: 100%;
			min-height: 0;
			overflow: hidden;
		}
		.inventory-bottom-bar {
			display: flex;
			/* Large balances must still fit when the window or theme leaves less room. */
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 4px var(--ui-inventory-padding);
			white-space: nowrap;
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
		.inventory-currency-icon :global(.ui-icon) {
			--ui-icon-rendering: var(--ui-inventory-pyreal-icon-upsample-filter);
		}
		/* PreparedUiIcon PNGs have a fixed 32px native extent; this compares CSS display sizes. */
		@container inventory-pyreal-icon (width < 32px) {
			.inventory-currency-icon :global(.ui-icon) {
				--ui-icon-rendering: var(--ui-inventory-pyreal-icon-downsample-filter);
			}
		}
		.inventory-equipment-strip {
			grid-column: 1;
			grid-row: 1 / -1;
			min-height: 0;
			border-right: var(--ui-inventory-divider);
		}
	}
</style>
