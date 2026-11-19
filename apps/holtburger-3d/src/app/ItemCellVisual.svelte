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
	import { untrack } from "svelte";
	import type { ItemCooldownAnimation } from "./item-cooldowns.svelte";
	import UiIcon from "./UiIcon.svelte";
	import type { UiIconDisplay } from "./ui-icon-repository";
	import type { ItemCellPresentation } from "./item-cell-presentation";
	interface Props {
		/** Leased artwork; callers retain ownership across DOM commits. */
		readonly display: UiIconDisplay | undefined;
		/** Item status composed by the same decision that labels the parent button. */
		readonly presentation: ItemCellPresentation;
		/** Hide the redundant marker where the surrounding UI already identifies equipment. */
		readonly showEquipped?: boolean;
		/** Active fill inputs, independent of icon artwork and countdown text updates. */
		readonly cooldownAnimation?: ItemCooldownAnimation | null;
	}
	const {
		display,
		presentation,
		showEquipped = true,
		cooldownAnimation = null,
	}: Props = $props();
	// Keying by deadline and duration keeps text ticks from restarting the CSS animation.
	const cooldownKey = $derived(
		cooldownAnimation === null
			? null
			: `${cooldownAnimation.deadlineMs}:${cooldownAnimation.durationSeconds}`,
	);
	const cooldownTiming = $derived.by(() => {
		if (cooldownKey === null) return null;
		const animation = untrack(() => cooldownAnimation);
		if (animation === null) return null;
		const remainingMs = Math.max(0, animation.deadlineMs - performance.now());
		const durationMs = animation.durationSeconds * 1000;
		return {
			key: cooldownKey,
			durationMs,
			delayMs: remainingMs - durationMs,
		};
	});
	const countParts = $derived(
		presentation.count === null
			? []
			: presentation.count < 1000
				? [{ type: "integer", value: String(presentation.count) }]
				: compactCount.formatToParts(presentation.count),
	);
</script>

<span class="item-cell-art" data-drag-preview><UiIcon {display} /></span>
{#if cooldownTiming !== null}
	{#key cooldownTiming.key}
		<span
			class="item-cooldown-fill"
			data-item-cooldown
			aria-hidden="true"
			style:--ui-item-cooldown-duration={`${cooldownTiming.durationMs}ms`}
			style:--ui-item-cooldown-delay={`${cooldownTiming.delayMs}ms`}
		></span>
	{/key}
{/if}
{#if presentation.count !== null}
	<span
		class="item-count-overlay"
		class:beside-structure={presentation.meter !== null}
		aria-hidden="true"
	>
		{#each countParts as part}
			{#if part.type === "compact"}<span class="item-count-overlay-suffix"
					>{part.value}</span
				>{:else}{part.value}{/if}
		{/each}
	</span>
{/if}
{#if presentation.meter !== null}
	<span class="item-cell-meter" aria-hidden="true">
		<span
			class="item-cell-meter-fill"
			class:nonempty={presentation.meter.fraction > 0}
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
			box-shadow: 0 0 0 1px var(--ui-item-structure-outline);
			pointer-events: none;
		}
		.item-cell-meter-fill {
			position: absolute;
			bottom: 0;
			width: 100%;
		}
		/* Keep small positive amounts visible without making exhausted items look usable. */
		.item-cell-meter-fill.nonempty {
			min-height: min(100%, var(--ui-item-structure-min-fill));
		}
		.item-equipped {
			position: absolute;
			right: 1px;
			bottom: 1px;
			padding: 0 2px;
			border-radius: 2px;
			background: var(--ui-item-equipped-background);
			color: var(--ui-item-equipped-color);
			font: bold
				calc(var(--ui-item-equipped-font-size) * var(--ui-text-scale)) / 1.2
				sans-serif;
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
		.item-cooldown-fill {
			position: absolute;
			inset: var(--ui-item-cell-padding);
			background: var(--ui-item-cooldown-fill);
			pointer-events: none;
			transform-origin: bottom;
			/* A shorter-duration item stays full until the shared remaining time reaches its own
			 * duration, matching retail's clamped ratio. */
			animation: item-cooldown-drain var(--ui-item-cooldown-duration) linear
				var(--ui-item-cooldown-delay) both;
		}
		@keyframes item-cooldown-drain {
			from {
				transform: scaleY(1);
			}
			to {
				transform: scaleY(0);
			}
		}
		.item-count-overlay {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			position: absolute;
			right: var(--ui-item-count-inset);
			bottom: var(--ui-item-count-inset);
			z-index: 1;
			pointer-events: none;
			max-width: calc(100% - 2 * var(--ui-item-count-inset));
			font: bold calc(var(--ui-item-count-font-size) * var(--ui-text-scale)) / 1
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
				var(--ui-item-structure-inset) + var(--ui-item-structure-width) +
					var(--ui-item-count-inset)
			);
			max-width: calc(
				100% - var(--ui-item-structure-inset) - var(--ui-item-structure-width) -
					2 * var(--ui-item-count-inset)
			);
		}
	}
</style>
