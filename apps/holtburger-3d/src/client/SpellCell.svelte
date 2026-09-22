<script lang="ts">
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { SpellCellAddress } from "./client-spell-bar-state";
	interface Props {
		/** Address and shortcut belong together; null for the unnumbered caster cell. */
		shortcut: {
			readonly address: SpellCellAddress;
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
	let { shortcut, spell, label, display, available, onactivate }: Props =
		$props();
	const digit = $derived(
		shortcut === null ? null : String((shortcut.address.slot + 1) % 10),
	);
	const accessibleLabel = $derived(
		shortcut === null
			? label
			: `${digit}: ${label} (key: ${shortcut.description})`,
	);
</script>

<button
	type="button"
	class="spell-cell ui-shortcut-cell ui-item-cell ui-item-selection ui-hud-button"
	data-spell-tab={shortcut?.address.tab}
	data-spell-cell={shortcut?.address.slot}
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
