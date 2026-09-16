<script lang="ts">
	import UiIcon from "./UiIcon.svelte";
	import ItemCountOverlay from "./ItemCountOverlay.svelte";
	import type { UiIconDisplay } from "./ui-icon-repository";
	import type { ItemCellPresentation } from "./item-cell-presentation";
	interface Props {
		/** Leased artwork; callers retain ownership across DOM commits. */
		readonly display: UiIconDisplay | undefined;
		/** Plain fallback name when artwork is unavailable. */
		readonly name: string;
		/** Item status composed by the same decision that labels the parent button. */
		readonly presentation: ItemCellPresentation;
		/** Complete tooltip, including caller-owned action hints. */
		readonly tooltipLabel: string;
		/** Hide the redundant marker where the surrounding UI already identifies equipment. */
		readonly showEquipped?: boolean;
	}
	const {
		display,
		name,
		presentation,
		tooltipLabel,
		showEquipped = true,
	}: Props = $props();
</script>

<span class="item-cell-art"><UiIcon {display} {name} {tooltipLabel} /></span>
<ItemCountOverlay
	count={presentation.count}
	besideStructure={presentation.meter !== null}
/>
{#if presentation.meter !== null}
	<span class="item-cell-meter" aria-hidden="true">
		<span
			class="item-cell-meter-fill"
			style:height={`${presentation.meter.fraction * 100}%`}
			style:background-color={`hsl(${presentation.meter.hue} 100% 45%)`}
		></span>
	</span>
{/if}
{#if showEquipped && presentation.equipped}
	<span
		class="item-equipped"
		class:above-count={presentation.count !== null}
		class:beside-meter={presentation.meter !== null}
		aria-hidden="true">✓</span
	>
{/if}

<style>
	@layer components {
		.item-cell-art {
			position: absolute;
			inset: var(--ui-item-cell-padding);
			display: grid;
			place-items: center;
			min-width: 0;
			overflow: hidden;
		}
		.item-cell-meter {
			position: absolute;
			top: var(--ui-item-structure-inset);
			right: var(--ui-item-structure-inset);
			bottom: var(--ui-item-structure-inset);
			width: var(--ui-item-structure-width);
			background: var(--ui-item-structure-background);
			pointer-events: none;
		}
		.item-cell-meter-fill {
			position: absolute;
			bottom: 0;
			width: 100%;
		}
		.item-equipped {
			position: absolute;
			right: 1px;
			bottom: 1px;
			padding: 0 2px;
			border-radius: 2px;
			background: var(--ui-item-equipped-background, #000b);
			color: var(--ui-item-equipped-color, #4ade80);
			font: bold var(--ui-item-equipped-font-size, 16px) / 1.2 sans-serif;
			pointer-events: none;
		}
		.item-equipped.above-count {
			top: 1px;
			bottom: auto;
		}
		.item-equipped.beside-meter {
			right: calc(
				var(--ui-item-structure-inset) + var(--ui-item-structure-width) + 1px
			);
		}
	}
</style>
