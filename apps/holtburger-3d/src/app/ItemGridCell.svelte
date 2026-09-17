<script lang="ts">
	import type { ItemCapacity } from "./item-capacity";
	import ItemCellVisual from "./ItemCellVisual.svelte";
	import { itemCellPresentation } from "./item-cell-presentation";
	import type { UiIconDisplay } from "./ui-icon-repository";
	import type { ItemStructure } from "./item-structure";
	interface Props {
		/** Stable accessible name and tooltip, also used when no visual is supplied. */
		readonly label: string;
		/** Leased artwork rendered by the shared item composition. */
		readonly display: UiIconDisplay | undefined;
		/** Confirmed equipment location controls both the marker and tooltip. */
		readonly equipped: boolean;
		/** Equipment slots can suppress the checkmark while retaining equipped status in the label. */
		readonly showEquipped?: boolean;
		/** Entity quantity, independent of artwork; only counts above one are displayed. */
		readonly count?: number | null;
		/** Optional structure properties; incomplete or full values have no indicator. */
		readonly structure?: ItemStructure | null;
		/** Known ordinary-slot occupancy; container capacity takes precedence over structure. */
		readonly capacity?: ItemCapacity | null;
		/** Null represents an unoccupied slot. No runtime entity contract is required. */
		readonly itemGuid: number | null;
		/** Selection and admission are controlled by the consuming UI. */
		readonly selected: boolean;
		/** Contextual dimming supplied by the consumer, independent of selection. */
		readonly dimmed?: boolean;
		readonly disabled: boolean;
		/** Consumer-owned action for an occupied cell. */
		readonly onselect: () => void;
		/** Optional cold pointer-hover notification for panel-local affordances. */
		readonly onHoverChange?: (hovered: boolean) => void;
	}
	const {
		label,
		itemGuid,
		selected,
		dimmed = false,
		disabled,
		onselect,
		onHoverChange,
		display,
		equipped,
		showEquipped = true,
		count,
		structure = null,
		capacity = null,
	}: Props = $props();
	const presentation = $derived(
		itemCellPresentation({
			label,
			count: itemGuid === null ? null : (count ?? null),
			structure: itemGuid === null ? null : structure,
			capacity: itemGuid === null ? null : capacity,
			equipped: itemGuid !== null && equipped,
		}),
	);
</script>

<button
	type="button"
	class="item-grid-cell ui-item-cell ui-item-selection ui-hud-button"
	data-empty={itemGuid === null}
	data-dimmed={dimmed}
	data-item-guid={itemGuid}
	title={presentation.label}
	aria-label={presentation.label}
	aria-pressed={selected}
	disabled={disabled || itemGuid === null}
	onclick={onselect}
	onpointerenter={() => onHoverChange?.(true)}
	onpointerleave={() => onHoverChange?.(false)}
>
	{#if itemGuid !== null}
		<ItemCellVisual
			{display}
			name={label}
			{presentation}
			{showEquipped}
			tooltipLabel={presentation.label}
		/>
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
	}
</style>
