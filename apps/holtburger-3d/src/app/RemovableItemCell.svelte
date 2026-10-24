<script lang="ts">
	import type { Snippet } from "svelte";

	/** Shared removal affordance around feature-owned item artwork and interactions. */
	interface Props {
		/** Existing cell remains responsible for selection, inspection, and drag sources. */
		readonly children: Snippet;
		/** Null means this cell has no removable preparation; the feature owns the action and lock. */
		readonly removal: {
			/** Describes the precise preparation removed by this action. */
			readonly label: string;
			/** Feature-owned lock, such as an outstanding payment. */
			readonly disabled: boolean;
			/** Feature owner revalidates and edits its local draft. */
			readonly onremove: () => void;
		} | null;
	}
	const { children, removal }: Props = $props();
</script>

<div class="removable-item-cell">
	{@render children()}
	{#if removal !== null}
		<button
			type="button"
			class="item-cell-remove"
			aria-label={removal.label}
			title={removal.label}
			disabled={removal.disabled}
			onclick={removal.onremove}>×</button
		>
	{/if}
</div>

<style>
	@layer components {
		.removable-item-cell {
			position: relative;
			width: calc(var(--ui-item-cell-min-size) * var(--ui-icon-scale));
			flex: none;
		}
		.item-cell-remove {
			position: absolute;
			top: -4px;
			right: -4px;
			z-index: 1;
			display: grid;
			place-items: center;
			width: 20px;
			height: 20px;
			padding: 0;
			border: 1px solid var(--ui-color-border);
			border-radius: 50%;
			background: color-mix(in srgb, var(--ui-color-shadow) 85%, transparent);
			color: var(--ui-color-text);
			font-size: 15px;
			font-weight: bold;
			line-height: 1;
			cursor: pointer;
			opacity: 0;
			pointer-events: none;
		}
		.removable-item-cell:hover .item-cell-remove,
		.removable-item-cell:focus-within .item-cell-remove {
			opacity: 1;
			pointer-events: auto;
		}
		.item-cell-remove:hover:not(:disabled),
		.item-cell-remove:focus-visible {
			color: var(--ui-color-highlight);
			border-color: currentColor;
		}
		.item-cell-remove:focus-visible {
			outline: 2px solid var(--ui-color-focus);
		}
		.item-cell-remove:disabled {
			color: var(--ui-color-muted);
			cursor: default;
		}
	}
</style>
