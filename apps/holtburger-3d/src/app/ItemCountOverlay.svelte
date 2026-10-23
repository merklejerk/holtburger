<script lang="ts" module>
	// Share the formatter across cells; explicit English notation fixes the K/M/B suffixes.
	const compactCount = new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumSignificantDigits: 2,
		// Never imply that a stack contains more items than it actually does.
		roundingMode: "floor",
	});
</script>

<script lang="ts">
	interface Props {
		/** Visible quantity supplied by the cell; null omits the overlay. */
		count: number | null;
		/** Inventory structure indicators reserve space at the right edge. */
		besideStructure: boolean;
	}
	let { count, besideStructure }: Props = $props();
	const countParts = $derived(
		count === null
			? []
			: count < 1000
				? [{ type: "integer", value: String(count) }]
				: compactCount.formatToParts(count),
	);
</script>

{#if count !== null}
	<span
		class="item-count-overlay"
		class:beside-structure={besideStructure}
		aria-hidden="true"
	>
		{#each countParts as part}
			{#if part.type === "compact"}<span class="item-count-overlay-suffix"
					>{part.value}</span
				>{:else}{part.value}{/if}
		{/each}
	</span>
{/if}

<style>
	@layer components {
		.item-count-overlay {
			position: absolute;
			right: calc(var(--ui-item-count-inset) * var(--ui-icon-scale));
			bottom: calc(var(--ui-item-count-inset) * var(--ui-icon-scale));
			z-index: 1;
			pointer-events: none;
			max-width: calc(
				100% - 2 * calc(var(--ui-item-count-inset) * var(--ui-icon-scale))
			);
			font: bold calc(var(--ui-item-count-font-size) * var(--ui-icon-scale)) / 1
				var(--ui-item-count-font-family);
			color: var(--ui-item-count-color);
			text-shadow: var(--ui-item-count-shadow);
			background: var(--ui-item-count-background);
		}
		.item-count-overlay-suffix {
			display: inline;
			font-size: var(--ui-item-count-suffix-font-size);
		}
		.item-count-overlay.beside-structure {
			right: calc(
				calc(var(--ui-item-structure-inset) * var(--ui-icon-scale)) +
					calc(var(--ui-item-structure-width) * var(--ui-icon-scale)) +
					calc(var(--ui-item-count-inset) * var(--ui-icon-scale))
			);
			max-width: calc(
				100% - calc(var(--ui-item-structure-inset) * var(--ui-icon-scale)) -
					calc(var(--ui-item-structure-width) * var(--ui-icon-scale)) - 2 *
					calc(var(--ui-item-count-inset) * var(--ui-icon-scale))
			);
		}
		span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
