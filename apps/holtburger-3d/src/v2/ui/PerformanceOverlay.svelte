<script lang="ts">
	import type { PerformanceMetricsSnapshot } from "./performance-metrics";

	interface Props {
		readonly metrics: PerformanceMetricsSnapshot;
	}

	let { metrics }: Props = $props();
</script>

<div class="performance-overlay" aria-label="Renderer performance">
	<span>{metrics.fps.toFixed(1)} FPS</span>
	<span>{metrics.frameMs.toFixed(1)} ms</span>
	<span>handler {metrics.handlerMs.toFixed(2)} ms</span>
</div>

<style>
	.performance-overlay {
		position: absolute;
		top: auto;
		bottom: 16px;
		left: 16px;
		z-index: 2;
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 6px 8px;
		border: 1px solid rgba(255, 214, 102, 0.65);
		border-radius: 4px;
		background: rgba(4, 12, 11, 0.86);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.7),
			0 10px 28px rgba(0, 0, 0, 0.38);
		color: #fff7cf;
		font-size: 11px;
		line-height: 1;
		pointer-events: none;
	}
</style>
