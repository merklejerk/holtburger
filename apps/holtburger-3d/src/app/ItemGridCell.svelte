<script lang="ts">
	interface Props {
		/** Display/accessibility label; text is the placeholder for future item icons. */
		readonly label: string;
		/** Null represents an unoccupied slot. No runtime entity contract is required. */
		readonly itemGuid: number | null;
		/** Selection and admission are controlled by the consuming UI. */
		readonly selected: boolean;
		readonly disabled: boolean;
		/** Consumer-owned action for an occupied cell. */
		readonly onselect: () => void;
	}
	const { label, itemGuid, selected, disabled, onselect }: Props = $props();
</script>

<button
	type="button"
	class="item-grid-cell ui-item-cell ui-item-selection ui-hud-button"
	data-empty={itemGuid === null}
	data-item-guid={itemGuid}
	title={label}
	aria-label={label}
	aria-pressed={selected}
	disabled={disabled || itemGuid === null}
	onclick={onselect}
>
	{#if itemGuid !== null}<span>{label}</span>{/if}
</button>

<style>
	@layer components {
		.item-grid-cell {
			aspect-ratio: 1;
			width: 100%;
			min-width: 0;
			min-height: 0;
			padding: var(--ui-item-cell-padding, 4px);
			overflow: hidden;
		}
		span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
