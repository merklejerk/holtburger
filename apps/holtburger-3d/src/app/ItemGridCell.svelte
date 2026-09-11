<script lang="ts" module>
	// Share the formatter across cells; explicit English notation fixes the K/M/B suffixes.
	const compactCount = new Intl.NumberFormat("en-US", {
		notation: "compact",
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	interface Props {
		/** Stable accessible name and tooltip, also used when no visual is supplied. */
		readonly label: string;
		/** Decorative content receives the full cell label for any nested diagnostic tooltip. */
		readonly visual?: Snippet<[label: string]>;
		/** Entity quantity, independent of artwork; only counts above one are displayed. */
		readonly count?: number | null;
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
	}: Props = $props();
	const visibleCount = $derived(
		itemGuid !== null && count !== undefined && count !== null && count > 1
			? count
			: null,
	);
	const countText = $derived(
		visibleCount === null
			? ""
			: visibleCount < 1000
				? String(visibleCount)
				: compactCount.format(visibleCount),
	);
	const accessibleLabel = $derived(
		visibleCount === null ? label : `${label} (quantity: ${visibleCount})`,
	);
</script>

<button
	type="button"
	class="item-grid-cell ui-item-cell ui-item-selection ui-hud-button"
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
			<span class="item-grid-cell-count" aria-hidden="true">{countText}</span>
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
		span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
