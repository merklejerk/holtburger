<script lang="ts">
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { SpellCellAddress } from "./client-spell-bar-state";
	interface Props {
		/** Optional grid placement; the bar owns its two-row slot ordering. */
		gridPosition?: { readonly column: number; readonly row: number };
		/** Persistent address for spell bar cells; null for the equipped-caster cell. */
		address: SpellCellAddress | null;
		/** Numbered shortcuts cover the first ten bar cells; the caster has its own. */
		shortcut: {
			readonly hint: string | null;
			readonly description: string;
		} | null;
		/** Persistent binding, independent of definition or artwork availability. */
		spell: number | null;
		/** Resolved name and diagnostic status for accessible presentation. */
		label: string;
		/** Consumer-leased artwork. */
		display: UiIconDisplay | undefined;
		/** Current activation availability, owned by the spellbook or caster consumer. */
		available: boolean;
		/** App-owned activation shared with keyboard input. */
		onactivate: () => void;
	}
	let {
		gridPosition,
		address,
		shortcut,
		spell,
		label,
		display,
		available,
		onactivate,
	}: Props = $props();
	const digit = $derived(
		shortcut === null || address === null
			? null
			: String((address.slot + 1) % 10),
	);
	const accessibleLabel = $derived(
		shortcut === null
			? label
			: `${digit === null ? "" : `${digit}: `}${label} (key: ${shortcut.description})`,
	);
</script>

<button
	type="button"
	class="spell-cell ui-shortcut-cell ui-item-cell ui-item-selection ui-hud-button"
	style:grid-column={gridPosition?.column}
	style:grid-row={gridPosition?.row}
	data-spell-tab={address?.tab}
	data-spell-cell={address?.slot}
	data-bound-spell={spell}
	data-empty={spell === null}
	data-dimmed={spell !== null && !available}
	aria-label={accessibleLabel}
	aria-disabled={!available}
	title={accessibleLabel}
	onclick={() => {
		if (available) onactivate();
	}}
>
	{#if spell !== null}<UiIcon
			{display}
			name={label}
			tooltipLabel={accessibleLabel}
		/>{/if}
	{#if shortcut?.hint != null}<span class="ui-shortcut-hint" aria-hidden="true"
			>{shortcut.hint}</span
		>{/if}
</button>

<style>
	@layer components {
		.spell-cell {
			--ui-hud-button-background: var(
				--ui-spell-cell-background,
				color-mix(
					in srgb,
					var(--ui-spell-bar-color) var(--ui-spell-cell-background-opacity),
					transparent
				)
			);
		}
		.spell-cell:global([data-spell-drop]) {
			outline: var(
				--ui-spell-drop-outline,
				2px solid var(--ui-spell-bar-color)
			);
			outline-offset: -2px;
		}
	}
</style>
