<script lang="ts">
	import { onMount } from "svelte";

	import { CLIENT_TUNING } from "./client-tuning";
	import type { ClientTargetIndicatorFrame } from "./client-target-indicator";

	interface Props {
		readonly readFrame: () => ClientTargetIndicatorFrame | null;
		readonly selectedGuid: number | null;
	}

	let { readFrame, selectedGuid }: Props = $props();
	let marker: HTMLDivElement;
	const tuning = CLIENT_TUNING.entitySelection.offscreenIndicator;

	onMount(() => {
		let frameHandle = 0;
		const update = (): void => {
			const frame = readFrame();
			if (frame === null) {
				marker.hidden = true;
			} else {
				marker.hidden = false;
				marker.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0) translate(-50%, -50%) rotate(${frame.rotationRadians}rad)`;
			}
			frameHandle = requestAnimationFrame(update);
		};
		frameHandle = requestAnimationFrame(update);
		return () => cancelAnimationFrame(frameHandle);
	});
</script>

<div
	bind:this={marker}
	class="target-indicator"
	hidden
	aria-hidden="true"
	style={`--target-size: ${tuning.sizeCssPixels}px; --target-fill: ${tuning.fillColor}; --target-outline: ${tuning.outlineColor}; --target-outline-width: ${tuning.outlineWidthCssPixels}px; --target-glow: ${tuning.glowColor}; --target-glow-blur: ${tuning.glowBlurCssPixels}px;`}
>
	<svg viewBox="0 0 28 28" aria-hidden="true">
		<path class="target-indicator__glass" d="M14 2.5 25 23.5 14 18.8 3 23.5Z" />
		<path class="target-indicator__facet" d="M14 4.3 14 17.1 5.8 20.6Z" />
	</svg>
</div>

<div class="selection-announcement" role="status" aria-live="polite">
	{selectedGuid === null
		? "No entity selected"
		: `Selected entity 0x${selectedGuid.toString(16).padStart(8, "0")}`}
</div>

<style>
	.target-indicator {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 3;
		width: var(--target-size);
		height: var(--target-size);
		pointer-events: none;
		transform-origin: center;
		will-change: transform;
		filter: drop-shadow(0 0 var(--target-glow-blur) var(--target-glow));
	}

	.target-indicator svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.target-indicator__glass {
		fill: var(--target-fill);
		stroke: var(--target-outline);
		stroke-width: var(--target-outline-width);
		stroke-linejoin: round;
		paint-order: stroke fill;
	}

	.target-indicator__facet {
		fill: var(--target-outline);
		fill-opacity: 0.16;
		stroke: none;
	}

	.selection-announcement {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
