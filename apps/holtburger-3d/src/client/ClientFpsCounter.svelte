<script lang="ts">
	import { onMount } from "svelte";
	import { FRONTEND_TUNING } from "../lib/frontend-tuning";

	interface Props {
		/** Cold read of the uncapped presentation throughput maintained outside Svelte. */
		readonly readFramesPerSecond: () => number | null;
	}

	const { readFramesPerSecond }: Props = $props();
	let framesPerSecond = $state<number | null>(null);
	const display = $derived(
		framesPerSecond === null ? "—" : framesPerSecond.toFixed(0),
	);

	onMount(() => {
		const sample = (): void => {
			framesPerSecond = readFramesPerSecond();
		};
		sample();
		const interval = window.setInterval(
			sample,
			FRONTEND_TUNING.diagnostics.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});
</script>

<output class="client-fps-counter" aria-label="Frames per second">
	{display} fps
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
