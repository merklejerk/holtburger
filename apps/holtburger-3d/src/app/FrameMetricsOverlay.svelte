<script lang="ts">
	import { onMount, untrack } from "svelte";
	import type { FrameRates } from "./frame-rate-sampler";
	import { FRONTEND_TUNING } from "../lib/frontend-tuning";

	export interface FrameMetrics {
		/** Total milliseconds spent in the runtime tick phase. */
		readonly tickMs: number;
		/** Total milliseconds spent advancing GamePresentationRuntime state and drawing it. */
		readonly updateFrameMs: number;
		/** Total measured frontend frame work in milliseconds. */
		readonly frameMs: number;
	}

	interface Props {
		/** Latest measured runtime frame timings. */
		metrics: FrameMetrics | null;
		/** Cold read of frame cadence and estimated capacity from the Explorer render loop. */
		readonly readFrameRates: () => FrameRates | null;
		/** EMA smoothing window in milliseconds. */
		emaWindowMs?: number;
	}

	let {
		metrics,
		readFrameRates,
		emaWindowMs = FRONTEND_TUNING.diagnostics.frameMetricsEmaWindowMs,
	}: Props = $props();
	let smoothedMetrics: FrameMetrics | null = $state(null);
	let frameRates = $state<FrameRates | null>(null);
	let lastSampleAt: number | null = null;

	const smooth = (current: number, next: number, alpha: number): number =>
		current + (next - current) * alpha;
	$effect(() => {
		const nextMetrics = metrics;

		untrack(() => {
			if (nextMetrics === null) {
				smoothedMetrics = null;
				lastSampleAt = null;
				return;
			}

			const sampledAt = performance.now();

			if (smoothedMetrics === null || lastSampleAt === null) {
				smoothedMetrics = nextMetrics;
				lastSampleAt = sampledAt;
				return;
			}

			const elapsedMs = Math.max(0, sampledAt - lastSampleAt);
			const alpha = 1 - Math.exp(-elapsedMs / Math.max(1, emaWindowMs));

			smoothedMetrics = {
				tickMs: smooth(smoothedMetrics.tickMs, nextMetrics.tickMs, alpha),
				updateFrameMs: smooth(
					smoothedMetrics.updateFrameMs,
					nextMetrics.updateFrameMs,
					alpha,
				),
				frameMs: smooth(smoothedMetrics.frameMs, nextMetrics.frameMs, alpha),
			};
			lastSampleAt = sampledAt;
		});
	});

	onMount(() => {
		const sample = (): void => {
			frameRates = readFrameRates();
		};
		sample();
		const interval = window.setInterval(
			sample,
			FRONTEND_TUNING.diagnostics.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});

	const formatMs = (value: number): string => value.toFixed(2);
	const formatFramesPerSecond = (value: number): string =>
		value > FRONTEND_TUNING.diagnostics.maximumDisplayedFramesPerSecond
			? `${FRONTEND_TUNING.diagnostics.maximumDisplayedFramesPerSecond}+`
			: value.toFixed(0);
	const displayFps = $derived(
		frameRates === null
			? "—/—"
			: `${formatFramesPerSecond(frameRates.capped)}/${formatFramesPerSecond(frameRates.uncapped)}`,
	);
</script>

{#if smoothedMetrics !== null}
	<aside class="frame-metrics-overlay" aria-label="Frame metrics">
		{displayFps} fps | tick {formatMs(smoothedMetrics.tickMs)} ms | update+draw {formatMs(
			smoothedMetrics.updateFrameMs,
		)} ms | frame {formatMs(smoothedMetrics.frameMs)} ms
	</aside>
{/if}

<style>
	.frame-metrics-overlay {
		position: absolute;
		left: 12px;
		bottom: 12px;
		z-index: 2;
		max-width: calc(100vw - 24px);
		padding: 3px 6px;
		overflow: hidden;
		color: #fff;
		font-family: var(--ac-font-ui);
		font-size: var(--ac-panel-font-size);
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		white-space: nowrap;
		text-overflow: ellipsis;
		background: rgb(0 0 0 / 0.58);
		text-shadow: 1px 1px 0 #000;
	}
</style>
