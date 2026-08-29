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

<output class="client-fps-counter" aria-label="Frames per second">
	{display} FPS
</output>

<style>
	.client-fps-counter {
		display: grid;
		width: 100%;
		height: 100%;
		padding: 3px 6px;
		place-items: center;
		color: #fff;
		font-family: var(--ac-font-ui);
		font-size: var(--ac-panel-font-size);
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		white-space: nowrap;
		pointer-events: none;
		background: radial-gradient(
			ellipse at center,
			rgb(0 0 0 / 0.58) 0,
			rgb(0 0 0 / 0.28) 48%,
			transparent 78%
		);
		text-shadow: 1px 1px 2px #000;
	}
</style>
