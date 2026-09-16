<script lang="ts">
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { SpellCellAddress } from "./client-spell-bar-state";
	interface Props {
		/** Exact address used by pointer transfers. */
		address: SpellCellAddress;
		/** Persistent binding, independent of definition or artwork availability. */
		spell: number | null;
		/** Resolved name and diagnostic status for accessible presentation. */
		label: string;
		/** Consumer-leased artwork. */
		display: UiIconDisplay | undefined;
		/** Current shortcut and spell knowledge availability. */
		available: boolean;
		/** App-owned activation shared with keyboard input. */
		onactivate: () => void;
	}
	let { address, spell, label, display, available, onactivate }: Props =
		$props();
	const digit = $derived(String((address.slot + 1) % 10));
</script>

<button
	type="button"
	class="spell-cell ui-shortcut-cell ui-item-cell ui-item-selection ui-hud-button"
	data-spell-tab={address.tab}
	data-spell-cell={address.slot}
	data-bound-spell={spell}
	data-empty={spell === null}
	data-dimmed={spell !== null && !available}
	aria-label={`${digit}: ${label}`}
	aria-disabled={!available}
	title={`${digit}: ${label}`}
	onclick={() => {
		if (available) onactivate();
	}}
>
	{#if spell !== null}<UiIcon
			{display}
			name={label}
			tooltipLabel={label}
		/>{/if}
	<span class="ui-shortcut-digit" aria-hidden="true">{digit}</span>
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
