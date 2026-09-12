<script lang="ts" module>
	// Share the formatter across cells; explicit English notation fixes the K/M/B suffixes.
	const compactCount = new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumSignificantDigits: 2,
	});
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
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
		readonly disabled: boolean;
		/** Consumer-owned action for an occupied cell. */
		readonly onselect: () => void;
	}
	const {
		label,
		itemGuid,
		selected,
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
	const countParts = $derived(
		visibleCount === null
			? []
			: visibleCount < 1000
				? [{ type: "integer", value: String(visibleCount) }]
				: compactCount.formatToParts(visibleCount),
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
	class:has-structure={structureDisplay !== null}
	data-empty={itemGuid === null}
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
		{#if visibleCount !== null}
			<span class="item-grid-cell-count" aria-hidden="true">
				{#each countParts as part}
					{#if part.type === "compact"}<span class="item-grid-cell-count-suffix"
							>{part.value}</span
						>{:else}{part.value}{/if}
				{/each}
			</span>
		{/if}
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
		.item-grid-cell-count {
			position: absolute;
			right: var(--ui-item-count-inset);
			bottom: var(--ui-item-count-inset);
			z-index: 1;
			pointer-events: none;
			max-width: calc(100% - 2 * var(--ui-item-count-inset));
			font: var(--ui-item-count-font);
			color: var(--ui-item-count-color);
			text-shadow: var(--ui-item-count-shadow);
			background: var(--ui-item-count-background);
		}
		.item-grid-cell-count-suffix {
			display: inline;
			font-size: var(--ui-item-count-suffix-font-size);
		}
		.has-structure .item-grid-cell-count {
			right: calc(
				var(--ui-item-structure-inset) + var(--ui-item-structure-width) +
					var(--ui-item-count-inset)
			);
			max-width: calc(
				100% - var(--ui-item-structure-inset) - var(--ui-item-structure-width) -
					2 * var(--ui-item-count-inset)
			);
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
