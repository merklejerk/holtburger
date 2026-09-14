<script lang="ts">
	import { APP_INPUT } from "../lib/input/app-input";
	import ItemCountOverlay from "../app/ItemCountOverlay.svelte";
	import { formatItemQuantity } from "../app/item-quantity";
	import ItemIcon from "../app/ItemIcon.svelte";
	import type { ItemIconDisplay } from "../app/item-icon-repository";
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
		display: ItemIconDisplay | undefined;
		/** Bound stack quantity; single items have no visible count. */
		count: number | null;
		/** Availability is presentation; activation still revalidates. */
		available: boolean;
		/** Confirmed equipment state controls the overlay and accessible status. */
		equipped: boolean;
		/** Keyboard selection, independent of entity selection. */
		selected: boolean;
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
		onactivate,
	}: Props = $props();
	const visibleCount = $derived(
		content !== null && count !== null && count > 1 ? count : null,
	);
	const quantityLabel = $derived(
		visibleCount === null
			? label
			: `${label} (quantity: ${formatItemQuantity(visibleCount)})`,
	);
	const statusLabel = $derived(
		equipped ? `${quantityLabel} (Equipped)` : quantityLabel,
	);
</script>

<button
	type="button"
	class="action-cell ui-item-cell ui-item-selection ui-hud-button"
	data-action-bar={bar}
	data-action-cell={digit}
	data-action-item={content?.item}
	data-empty={content === null}
	data-dimmed={content !== null && !available}
	aria-label={`${digit}: ${statusLabel}`}
	title={`${digit}: ${statusLabel}`}
	aria-pressed={selected}
	onclick={(event) => onactivate(APP_INPUT.actionBarAlternate(event))}
>
	{#if content !== null}<ItemIcon
			{display}
			name={label}
			tooltipLabel={statusLabel}
		/>{/if}
	{#if equipped}<span
			class="action-equipped"
			class:above-count={visibleCount !== null}
			aria-hidden="true">✓</span
		>{/if}
	<ItemCountOverlay count={visibleCount} besideStructure={false} />
	<span class="action-digit" aria-hidden="true">{digit}</span>
</button>

<style>
	@layer components {
		.action-cell {
			display: block;
			overflow: hidden;
			position: relative;
			width: 100%;
			height: 100%;
			min-width: 0;
			min-height: 0;
			padding: var(--ui-item-cell-padding);
			user-select: none;
		}
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
		.action-digit {
			position: absolute;
			left: 2px;
			top: 0;
			font-size: 10px;
			color: var(--ui-color-text);
			text-shadow: 0 1px 2px black;
			pointer-events: none;
		}
	}
</style>
