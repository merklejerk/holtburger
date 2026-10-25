<script lang="ts">
	import {
		useItemCooldown,
		type ItemCooldownDefinition,
	} from "../app/item-cooldowns.svelte";
	import ClientLoadoutVisual from "./ClientLoadoutVisual.svelte";
	import { loadoutTooltip } from "./client-loadout";
	import ActionAlternateIcon from "../assets/icons/action-alternate.svg?component";
	import { useClientInput } from "./client-input-context";
	import ItemCellVisual from "../app/ItemCellVisual.svelte";
	import { itemCellPresentation } from "../app/item-cell-presentation";
	import type { ItemStructure } from "../app/item-structure";
	import type { ItemCapacity } from "../app/item-capacity";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ActionContent } from "./client-action-bar-state";
	const clientInput = useClientInput();
	interface Props {
		/** Stable bar identity for binding gestures. */
		bar: number;
		/** One of the visible digit addresses 1–9/0. */
		digit: string;
		/** Compact first shortcut, separate from the stable cell address. */
		bindingHint: string | null;
		/** All configured keyboard alternatives in readable form. */
		bindingDescription: string;
		/** Configured modifier for alternate pointer or keyboard activation. */
		alternateModifier: string;
		/** Alternate action available for this item, independent of held modifiers. */
		alternateAction: string | null;
		/** Persistent reference, including temporarily unavailable items. */
		content: ActionContent | null;
		/** Current resolved name, or an unavailable identity label. */
		label: string;
		/** Existing repository artwork with a display lease owned by the collection. */
		display: UiIconDisplay | undefined;
		/** Bound stack quantity; single items have no visible count. */
		count: number | null;
		/** Remaining uses or durability of the bound item. */
		structure: ItemStructure | null;
		/** Known occupancy for a bound container. */
		capacity: ItemCapacity | null;
		/** Bound item's authored reuse group; cooldown never changes binding identity. */
		cooldown: ItemCooldownDefinition | null;
		/** Availability is presentation; activation still revalidates. */
		available: boolean;
		/** Confirmed equipment state controls the overlay and accessible status. */
		equipped: boolean;
		/** Keyboard selection, independent of entity selection. */
		selected: boolean;
		/** Alternate behavior to advertise while this bar owns focus and its modifier is held. */
		alternateLabel: string | null;
		/** Execute content through the collection's session capability. */
		onactivate: (alternate: boolean) => void;
	}
	let {
		bar,
		digit,
		bindingHint,
		bindingDescription,
		alternateModifier,
		alternateAction,
		content,
		label,
		display,
		count,
		structure,
		capacity,
		cooldown,
		available,
		equipped,
		selected,
		alternateLabel,
		onactivate,
	}: Props = $props();
	const anchorName = $derived(`--action-cell-${bar}-${digit}`);
	const cooldownStatus = useItemCooldown(() => cooldown, "tooltip");
	function showAlternateMarker(element: HTMLElement): void {
		// The top layer escapes the bar's scroll clipping; removing the marker closes its popover.
		element.showPopover();
	}
	const presentation = $derived(
		itemCellPresentation({
			label,
			cooldownSeconds: cooldownStatus.seconds,
			count: content === null ? null : count,
			structure: content === null ? null : structure,
			capacity: content === null ? null : capacity,
			equipped: content !== null && equipped,
		}),
	);
	const activeAlternate = $derived(available ? alternateLabel : null);
	const tooltip = $derived(
		[
			`${digit}: ${content?.kind === "loadout" ? loadoutTooltip(content) : presentation.label}`,
			`Key (focused bar): ${bindingDescription}`,
			...(alternateAction === null
				? []
				: [`Alternate: ${alternateAction} (${alternateModifier}+click)`]),
		].join("\n"),
	);
</script>

<button
	type="button"
	class="action-cell ui-shortcut-cell ui-item-cell ui-item-selection ui-hud-button"
	data-action-bar={bar}
	data-action-cell={digit}
	style:anchor-name={anchorName}
	data-action-item={content !== null && content.kind !== "loadout"
		? content.item
		: undefined}
	data-empty={content === null}
	data-dimmed={content !== null && !available}
	aria-label={tooltip}
	title={tooltip}
	aria-pressed={selected}
	onclick={(event) => onactivate(clientInput.actionBarAlternate(event))}
>
	{#if content?.kind === "loadout"}
		<ClientLoadoutVisual icon={content.icon} />
	{:else if content !== null}
		<ItemCellVisual
			cooldownAnimation={cooldownStatus.animation}
			{display}
			name={label}
			{presentation}
			tooltipLabel={tooltip}
		/>
	{/if}
	{#if activeAlternate !== null}<span
			class="action-alternate"
			popover="manual"
			style:position-anchor={anchorName}
			use:showAlternateMarker
			aria-hidden="true"
		>
			<ActionAlternateIcon />
		</span>{/if}
	{#if bindingHint !== null}<span class="ui-shortcut-hint" aria-hidden="true"
			>{bindingHint}</span
		>{/if}
</button>

<style>
	@layer components {
		.action-alternate {
			position: fixed;
			position-area: top;
			position-try-fallbacks: flip-block;
			position-visibility: anchors-visible;
			inset: auto;
			margin: 0 0 calc(var(--ui-action-alternate-gap) * var(--ui-icon-scale));
			padding: 0;
			width: calc(var(--ui-action-alternate-width) * var(--ui-icon-scale));
			height: calc(var(--ui-action-alternate-height) * var(--ui-icon-scale));
			border: 0;
			overflow: visible;
			background: transparent;
			color: var(--ui-action-alternate-color, var(--ui-color-warning));
			pointer-events: none;
			filter: var(--ui-action-alternate-filter);
		}
		.action-alternate::backdrop {
			display: none;
		}
	}
</style>
