<script lang="ts">
	import {
		useItemCooldown,
		type ItemCooldownDefinition,
	} from "./item-cooldowns.svelte";
	import type { ItemCapacity } from "./item-capacity";
	import ItemCellVisual from "./ItemCellVisual.svelte";
	import { itemCellPresentation } from "./item-cell-presentation";
	import type { UiIconDisplay } from "./ui-icon-repository";
	import type { ItemStructure } from "./item-structure";
	interface CellProps {
		/** Stable accessible name and tooltip, also used when no visual is supplied. */
		readonly label: string;
		/** Leased artwork rendered by the shared item composition. */
		readonly display: UiIconDisplay | undefined;
		/** Optional desired-item artwork for an empty slot; does not imply occupancy. */
		readonly placeholderDisplay?: UiIconDisplay;
		/** Confirmed equipment location controls both the marker and tooltip. */
		readonly equipped: boolean;
		/** Equipment slots can suppress the checkmark while retaining equipped status in the label. */
		readonly showEquipped?: boolean;
		/** Entity quantity, independent of artwork; only counts above one are displayed. */
		readonly count?: number | null;
		/** Consumer-owned stack action hint; omitted when the action is unavailable. */
		readonly quantityActionHint?: string | null;
		/** Optional structure properties; incomplete or full values have no indicator. */
		readonly structure?: ItemStructure | null;
		/** Known ordinary-slot occupancy; container capacity takes precedence over structure. */
		readonly capacity?: ItemCapacity | null;
		/** World-authored group membership; absent cells never subscribe to countdowns. */
		readonly cooldown?: ItemCooldownDefinition | null;
		/** Selection and admission are controlled by the consuming UI. */
		readonly selected: boolean;
		/** Contextual dimming supplied by the consumer, independent of selection. */
		readonly dimmed?: boolean;
		readonly disabled: boolean;
		/** Consumer-owned action for an occupied cell. */
		readonly onselect: () => void;
		/** Optional consumer-owned secondary action, such as inspecting a payment item. */
		readonly oncontextmenu?: (event: MouseEvent) => void;
		/** Optional cold pointer-hover notification for panel-local affordances. */
		readonly onHoverChange?: (hovered: boolean) => void;
	}
	/** A template projection cannot simultaneously identify a physical inventory object. */
	type Props = CellProps &
		(
			| {
					/** Null represents an unoccupied inventory slot. */
					readonly itemGuid: number | null;
					readonly templateWcid?: null;
			  }
			| {
					/** Requirement drafts do not fabricate a physical GUID or stack count. */
					readonly itemGuid: null;
					/** Authored template represented by the shared cell artwork. */
					readonly templateWcid: number;
			  }
		);
	const {
		label,
		itemGuid,
		templateWcid = null,
		selected,
		dimmed = false,
		disabled,
		onselect,
		oncontextmenu,
		onHoverChange,
		display,
		placeholderDisplay,
		equipped,
		showEquipped = true,
		count,
		quantityActionHint,
		structure = null,
		capacity = null,
		cooldown = null,
	}: Props = $props();
	const cooldownStatus = useItemCooldown(
		() => (itemGuid === null ? null : cooldown),
		"tooltip",
	);
	const empty = $derived(itemGuid === null && templateWcid === null);
	const placeholderReady = $derived(
		placeholderDisplay?.kind === "ready" ||
			placeholderDisplay?.kind === "degraded",
	);
	const presentation = $derived(
		itemCellPresentation({
			label,
			cooldownSeconds: cooldownStatus.seconds,
			count: itemGuid === null ? null : (count ?? null),
			quantityActionHint,
			structure: itemGuid === null ? null : structure,
			capacity: itemGuid === null ? null : capacity,
			equipped: itemGuid !== null && equipped,
		}),
	);
</script>

<button
	type="button"
	class="item-grid-cell ui-item-cell ui-item-selection ui-hud-button"
	data-empty={empty}
	data-template-wcid={templateWcid}
	data-dimmed={dimmed}
	data-item-guid={itemGuid}
	title={presentation.label}
	aria-label={presentation.label}
	aria-pressed={selected}
	disabled={disabled || empty}
	onclick={onselect}
	{oncontextmenu}
	onpointerenter={() => onHoverChange?.(true)}
	onpointerleave={() => onHoverChange?.(false)}
>
	{#if !empty || placeholderReady}
		<ItemCellVisual
			display={empty ? placeholderDisplay : display}
			name={label}
			{presentation}
			cooldownAnimation={cooldownStatus.animation}
			{showEquipped}
			tooltipLabel={presentation.label}
		/>
	{/if}
</button>

<style>
	@layer components {
		.item-grid-cell[data-empty="true"] :global(.item-cell-art) {
			filter: grayscale(1);
			opacity: 0.5;
			pointer-events: none;
		}
		.item-grid-cell {
			user-select: none;
			position: relative;
			aspect-ratio: 1;
			width: 100%;
			min-width: 0;
			min-height: 0;
			padding: calc(var(--ui-item-cell-padding) * var(--ui-icon-scale));
			overflow: hidden;
		}
	}
</style>
