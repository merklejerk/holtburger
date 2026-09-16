<script lang="ts">
	import { APP_INPUT } from "../lib/input/app-input";
	import ItemCountOverlay from "../app/ItemCountOverlay.svelte";
	import { formatItemQuantity } from "../app/item-quantity";
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ActionContent } from "./client-action-bar-state";
	interface Props {
		/** Stable bar identity for binding gestures. */
		bar: number;
		/** One of the visible digit addresses 1–9/0. */
		digit: string;
		/** Persistent reference, including temporarily unavailable items. */
		content: ActionContent | null;
		/** Current resolved name, or an unavailable identity label. */
		label: string;
		/** Existing repository artwork with a display lease owned by the collection. */
		display: UiIconDisplay | undefined;
		/** Bound stack quantity; single items have no visible count. */
		count: number | null;
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
		content,
		label,
		display,
		count,
		available,
		equipped,
		selected,
		alternateLabel,
		onactivate,
	}: Props = $props();
	// Both strokes share geometry so theme outline changes cannot reveal a mismatched silhouette.
	const alternateArrowPath = "M6 10h24m-6-6 6 6-6 6M30 20H6m6-6-6 6 6 6";
	const anchorName = $derived(`--action-cell-${bar}-${digit}`);
	function showAlternateMarker(element: HTMLElement): void {
		// The top layer escapes the bar's scroll clipping; removing the marker closes its popover.
		element.showPopover();
	}
	const visibleCount = $derived(
		content !== null && count !== null && count > 1 ? count : null,
	);
	const quantityLabel = $derived(
		visibleCount === null
			? label
			: `${label} (quantity: ${formatItemQuantity(visibleCount)})`,
	);
	const activeAlternate = $derived(available ? alternateLabel : null);
	const equipmentLabel = $derived(
		equipped ? `${quantityLabel} (Equipped)` : quantityLabel,
	);
	const statusLabel = $derived(
		activeAlternate === null
			? equipmentLabel
			: `${equipmentLabel} (${activeAlternate})`,
	);
</script>

<button
	type="button"
	class="action-cell ui-shortcut-cell ui-item-cell ui-item-selection ui-hud-button"
	data-action-bar={bar}
	data-action-cell={digit}
	style:anchor-name={anchorName}
	data-action-item={content?.item}
	data-empty={content === null}
	data-dimmed={content !== null && !available}
	aria-label={`${digit}: ${statusLabel}`}
	title={`${digit}: ${statusLabel}`}
	aria-pressed={selected}
	onclick={(event) => onactivate(APP_INPUT.actionBarAlternate(event))}
>
	{#if content !== null}<UiIcon
			{display}
			name={label}
			tooltipLabel={statusLabel}
		/>{/if}
	{#if equipped}<span
			class="action-equipped"
			class:above-count={visibleCount !== null}
			aria-hidden="true">✓</span
		>{/if}
	{#if activeAlternate !== null}<span
			class="action-alternate"
			popover="manual"
			style:position-anchor={anchorName}
			use:showAlternateMarker
			aria-hidden="true"
		>
			<svg
				viewBox="0 0 36 30"
				fill="none"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path class="alternate-outline" d={alternateArrowPath} />
				<path d={alternateArrowPath} />
			</svg>
		</span>{/if}
	<ItemCountOverlay count={visibleCount} besideStructure={false} />
	<span class="ui-shortcut-digit" aria-hidden="true">{digit}</span>
</button>

<style>
	@layer components {
		.action-equipped {
			position: absolute;
			right: 1px;
			bottom: 1px;
			padding: 0 2px;
			border-radius: 2px;
			background: var(--ui-action-equipped-background, #000b);
			color: var(--ui-action-equipped-color, #4ade80);
			font: bold var(--ui-action-equipped-font-size, 16px) / 1.2 sans-serif;
			pointer-events: none;
		}
		.action-equipped.above-count {
			top: 1px;
			bottom: auto;
		}
		.action-alternate {
			position: fixed;
			position-area: top;
			position-try-fallbacks: flip-block;
			position-visibility: anchors-visible;
			inset: auto;
			margin: 0 0 var(--ui-action-alternate-gap);
			padding: 0;
			width: var(--ui-action-alternate-width);
			height: var(--ui-action-alternate-height);
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
		.action-alternate svg {
			display: block;
			width: 100%;
			height: 100%;
			stroke: currentColor;
			stroke-width: var(--ui-action-alternate-stroke-width);
		}
		.action-alternate .alternate-outline {
			stroke: var(--ui-action-alternate-outline-color);
			stroke-width: var(--ui-action-alternate-outline-width);
		}
	}
</style>
