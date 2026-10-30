<script lang="ts">
	import { onMount } from "svelte";
	import type { ClientEntityScreenPoint } from "./client-entity-projection";

	interface Props {
		/** Pull coherent projected presentation facts without routing poses through Svelte. */
		readonly readFrame: () => ClientEntityScreenPoint | null;
	}
	let { readFrame }: Props = $props();
	let marker: HTMLDivElement;

	onMount(() => {
		let handle = 0;
		const update = (): void => {
			const frame = readFrame();
			marker.hidden = frame === null;
			if (frame !== null)
				marker.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0)`;
			handle = requestAnimationFrame(update);
		};
		handle = requestAnimationFrame(update);
		return () => cancelAnimationFrame(handle);
	});
</script>

<div bind:this={marker} class="combat-reticle" hidden aria-hidden="true">
	<div class="combat-reticle-orbit">
		{#each [0, 90, 180, 270] as angle}
			<div
				class="combat-reticle-spoke"
				style={`transform: rotate(${angle}deg)`}
			>
				<div class="combat-reticle-pulse">
					<svg class="combat-reticle-diamond" viewBox="0 0 24 24">
						<!-- Each spoke translates along positive X, so the elongated negative-X tip faces the target. -->
						<path class="diamond-border" d="M1 12 L16 6 L22 12 L16 18 Z" />
						<path class="diamond-body" d="M1 12 L16 6 L22 12 L16 18 Z" />
					</svg>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	@layer components {
		.combat-reticle {
			position: absolute;
			top: 0;
			left: 0;
			width: 0;
			height: 0;
			z-index: 3;
			pointer-events: none;
		}
		.combat-reticle-orbit,
		.combat-reticle-spoke,
		.combat-reticle-pulse {
			position: absolute;
			width: 0;
			height: 0;
		}
		.combat-reticle-orbit {
			animation: combat-reticle-orbit var(--ui-combat-reticle-orbit-duration)
				linear infinite;
		}
		.combat-reticle-pulse {
			animation: combat-reticle-pulse var(--ui-combat-reticle-pulse-duration)
				ease-in-out infinite;
		}
		.combat-reticle-diamond {
			position: absolute;
			left: calc(var(--ui-combat-reticle-size) / -2);
			top: calc(var(--ui-combat-reticle-size) / -2);
			width: var(--ui-combat-reticle-size);
			height: var(--ui-combat-reticle-size);
			overflow: visible;
			filter: drop-shadow(
				0 0 var(--ui-combat-reticle-glow-blur)
					var(--ui-combat-reticle-glow-color)
			);
			stroke-linejoin: round;
		}
		.diamond-border {
			fill: none;
			stroke: var(--ui-combat-reticle-border-color);
			stroke-width: var(--ui-combat-reticle-border-width);
		}
		.diamond-body {
			fill: var(--ui-combat-reticle-fill-color);
			stroke: var(--ui-combat-reticle-outline-color);
			stroke-width: var(--ui-combat-reticle-outline-width);
		}
		@keyframes combat-reticle-orbit {
			to {
				transform: rotate(360deg);
			}
		}
		@keyframes combat-reticle-pulse {
			0%,
			100% {
				transform: translateX(var(--ui-combat-reticle-radius));
			}
			50% {
				transform: translateX(
					calc(
						var(--ui-combat-reticle-radius) +
							var(--ui-combat-reticle-pulse-travel)
					)
				);
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.combat-reticle-orbit,
			.combat-reticle-pulse {
				animation: none;
			}
			.combat-reticle-pulse {
				transform: translateX(var(--ui-combat-reticle-radius));
			}
		}
	}
</style>
