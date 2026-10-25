<script lang="ts">
	import { untrack } from "svelte";
	import type { ItemCooldownAnimation } from "./item-cooldowns.svelte";
	interface Props {
		/** Fixed inputs for this keyed animation; text ticks do not restart it. */
		readonly animation: ItemCooldownAnimation;
	}
	const { animation }: Props = $props();
	// The parent keys this component by deadline and duration; text ticks retain its animation.
	const { remainingMs, durationMs } = untrack(() => {
		const remainingMs = Math.max(0, animation.deadlineMs - performance.now());
		const durationMs = animation.durationSeconds * 1000;
		return {
			remainingMs,
			durationMs,
		};
	});
</script>

<span
	class="item-cooldown-fill"
	data-item-cooldown
	aria-hidden="true"
	style:--ui-item-cooldown-duration={`${durationMs}ms`}
	style:--ui-item-cooldown-delay={`${remainingMs - durationMs}ms`}
></span>

<style>
	@layer components {
		.item-cooldown-fill {
			position: absolute;
			inset: calc(var(--ui-item-cell-padding) * var(--ui-icon-scale));
			background: var(--ui-item-cooldown-fill);
			pointer-events: none;
			transform-origin: bottom;
			/* A shorter-duration item stays full until the shared remaining time reaches its
			   own duration, matching retail acclient.c:262320-262324's clamped ratio. */
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
	}
</style>
