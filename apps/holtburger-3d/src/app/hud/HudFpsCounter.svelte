<script lang="ts">
	import { onMount } from "svelte";
	import type { FrameRates } from "../performance/frame-rate-sampler";

	interface Props {
		/** Cold read of presentation cadence and capacity maintained outside Svelte. */
		readonly readFrameRates: () => FrameRates | null;
		/** Display ceiling and polling cadence owned by the host frontend's tuning. */
		readonly diagnosticsTuning: {
			readonly maximumDisplayedFramesPerSecond: number;
			readonly frameRateDisplayIntervalMs: number;
		};
	}

	const { readFrameRates, diagnosticsTuning }: Props = $props();
	let frameRates = $state<FrameRates | null>(null);
	const formatFramesPerSecond = (value: number): string =>
		value > diagnosticsTuning.maximumDisplayedFramesPerSecond
			? `${diagnosticsTuning.maximumDisplayedFramesPerSecond}+`
			: value.toFixed(0);
	// Report presentation callback cadence directly, including the configured pacing margin.
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
			diagnosticsTuning.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});
</script>

<output class="hud-fps-counter ui-readout" aria-label="Frames per second">
	{display} FPS
</output>

<style>
	@layer components {
		.hud-fps-counter {
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
