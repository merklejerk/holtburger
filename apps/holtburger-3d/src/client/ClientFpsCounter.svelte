<script lang="ts">
	import { onMount } from "svelte";
	import type { FrameRates } from "../app/frame-rate-sampler";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Cold read of presentation cadence and capacity maintained outside Svelte. */
		readonly readFrameRates: () => FrameRates | null;
	}

	const { readFrameRates }: Props = $props();
	let frameRates = $state<FrameRates | null>(null);
	const formatFramesPerSecond = (value: number): string =>
		value > CLIENT_TUNING.diagnostics.maximumDisplayedFramesPerSecond
			? `${CLIENT_TUNING.diagnostics.maximumDisplayedFramesPerSecond}+`
			: value.toFixed(0);
	const display = $derived(
		frameRates === null
			? "— / —"
			: `${formatFramesPerSecond(frameRates.capped)} / ${formatFramesPerSecond(frameRates.uncapped)}`,
	);

	onMount(() => {
		const sample = (): void => {
			frameRates = readFrameRates();
		};
		sample();
		const interval = window.setInterval(
			sample,
			CLIENT_TUNING.diagnostics.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});
</script>

<output class="client-fps-counter ui-readout" aria-label="Frames per second">
	{display} FPS
</output>

<style>
	@layer components {
		.client-fps-counter {
			display: grid;
			width: 100%;
			height: 100%;
			padding-block: 3px;
			place-items: center;
			font-variant-numeric: tabular-nums;
			line-height: 1.2;
			white-space: nowrap;
			pointer-events: none;
		}
	}
</style>
