<script lang="ts">
	import type { Snippet } from "svelte";
	import ItemCountOverlay from "./ItemCountOverlay.svelte";
	import { formatItemQuantity } from "./item-quantity";
	import { itemStructureDisplay, type ItemStructure } from "./item-structure";
	interface Props {
		/** Stable accessible name and tooltip, also used when no visual is supplied. */
		readonly label: string;
		/** Decorative content receives the full cell label for any nested diagnostic tooltip. */
		readonly visual?: Snippet<[label: string]>;
		/** Entity quantity, independent of artwork; only counts above one are displayed. */
		readonly count?: number | null;
		/** Optional structure properties; incomplete or full values have no indicator. */
		readonly structure?: ItemStructure | null;
		/** Null represents an unoccupied slot. No runtime entity contract is required. */
		readonly itemGuid: number | null;
		/** Selection and admission are controlled by the consuming UI. */
		readonly selected: boolean;
		/** Contextual dimming supplied by the consumer, independent of selection. */
		readonly dimmed?: boolean;
		readonly disabled: boolean;
		/** Consumer-owned action for an occupied cell. */
		readonly onselect: () => void;
	}
	const {
		label,
		itemGuid,
		selected,
		dimmed = false,
		disabled,
		onselect,
		visual,
		count,
		structure = null,
	}: Props = $props();
	const visibleCount = $derived(
		itemGuid !== null && count !== undefined && count !== null && count > 1
			? count
			: null,
	);
	const structureDisplay = $derived(
		itemGuid === null ? null : itemStructureDisplay(structure),
	);
	const quantityLabel = $derived(
		visibleCount === null
			? label
			: `${label} (quantity: ${formatItemQuantity(visibleCount)})`,
	);
	const accessibleLabel = $derived(
		structureDisplay === null
			? quantityLabel
			: `${quantityLabel} ${structureDisplay.label}`,
	);
</script>

<button
	type="button"
	class="item-grid-cell ui-item-cell ui-item-selection ui-hud-button"
	data-empty={itemGuid === null}
	data-dimmed={dimmed}
	data-item-guid={itemGuid}
	title={accessibleLabel}
	aria-label={accessibleLabel}
	aria-pressed={selected}
	disabled={disabled || itemGuid === null}
	onclick={onselect}
>
	{#if itemGuid !== null}
		{#if visual}<span class="item-grid-cell-visual"
				>{@render visual(accessibleLabel)}</span
			>{:else}<span>{label}</span>{/if}
		<ItemCountOverlay
			count={visibleCount}
			besideStructure={structureDisplay !== null}
		/>
		{#if structureDisplay !== null}
			<span class="item-grid-cell-structure" aria-hidden="true">
				<span
					class="item-grid-cell-structure-fill"
					style:height={`${structureDisplay.fraction * 100}%`}
					style:background-color={`hsl(${structureDisplay.fraction * 120} 100% 45%)`}
				></span>
			</span>
		{/if}
	{/if}
</button>

<style>
	@layer components {
		.item-grid-cell {
			user-select: none;
			position: relative;
			aspect-ratio: 1;
			width: 100%;
			min-width: 0;
			min-height: 0;
			padding: var(--ui-item-cell-padding);
			overflow: hidden;
		}
		.item-grid-cell-visual {
			position: absolute;
			inset: var(--ui-item-cell-padding);
			display: grid;
			place-items: center;
		}
		.item-grid-cell-structure {
			position: absolute;
			top: var(--ui-item-structure-inset);
			right: var(--ui-item-structure-inset);
			bottom: var(--ui-item-structure-inset);
			width: var(--ui-item-structure-width);
			background: var(--ui-item-structure-background);
			pointer-events: none;
		}
		.item-grid-cell-structure-fill {
			position: absolute;
			bottom: 0;
			width: 100%;
		}
		span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
