<script lang="ts">
	import { onMount } from "svelte";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import ExplorerTools from "./ExplorerTools.svelte";
	import { GameRuntime } from "../lib/game/runtime/game-runtime";
	import { StandardCommitPipeline } from "../lib/game/commit/pipeline";
	import { WebGL2Device } from "../lib/game/renderer/webgl2-device";
	import type { WebGL2Renderer } from "../lib/game/renderer/webgl2-renderer";
	import { TauriAssetBridge } from "../lib/assets/tauri-asset-bridge";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
	let commitPipeline: StandardCommitPipeline | undefined;
	let webglDevice: WebGL2Device | undefined;
	let webglRenderer: WebGL2Renderer | undefined;
	let frameMetrics: FrameMetrics | null = $state(null);
	let startupError: string | null = $state(null);

	onMount(() => {
		if (canvasElement === null) {
			startupError = "Explorer canvas was not mounted.";
			return;
		}

		let destroyed = false;
		let teardown: Promise<void> | undefined;

		const stopFrameLoop = (): void => {
			if (frameHandle === null) return;
			window.cancelAnimationFrame(frameHandle);
			frameHandle = null;
		};

		const destroySystems = (): Promise<void> => {
			if (teardown) return teardown;
			const runtime = gameRuntime;
			const pipeline = commitPipeline;
			const device = webglDevice;
			const renderer = webglRenderer;
			gameRuntime = undefined;
			commitPipeline = undefined;
			webglDevice = undefined;
			webglRenderer = undefined;
			teardown = (async () => {
				stopFrameLoop();
				try {
					await runtime?.destroy();
				} finally {
					try {
						await pipeline?.destroy();
					} finally {
						try {
							await renderer?.destroy();
						} finally {
							await device?.destroy();
						}
					}
				}
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				const hostAssets = TauriAssetBridge.build();
				webglDevice = await WebGL2Device.build(canvasElement!);
				if (destroyed) return;
				commitPipeline = await StandardCommitPipeline.build(hostAssets);
				if (destroyed) return;

				gameRuntime = await GameRuntime.build(
					webglDevice.resources,
					commitPipeline,
					hostAssets,
				);
				if (destroyed) return;
				webglRenderer = await webglDevice.buildRenderer(
					gameRuntime.renderWorld,
				);
				if (destroyed) return;

				const step = (): void => {
					if (gameRuntime === undefined) {
						frameMetrics = null;
						frameHandle = window.requestAnimationFrame(step);
						return;
					}

					const tickStartedAt = performance.now();
					gameRuntime.tick();
					const drawStartedAt = performance.now();
					webglRenderer?.drawFrame(
						gameRuntime.createFrameInput(performance.now() / 1_000),
					);
					const frameFinishedAt = performance.now();

					frameMetrics = {
						tickMs: drawStartedAt - tickStartedAt,
						updateFrameMs: frameFinishedAt - drawStartedAt,
						frameMs: frameFinishedAt - tickStartedAt,
					};
					frameHandle = window.requestAnimationFrame(step);
				};

				frameHandle = window.requestAnimationFrame(step);
			} catch (error) {
				startupError =
					error instanceof Error
						? error.message
						: "Failed to initialize renderer.";
				await destroySystems();
			}
		};

		const startup = start();

		return () => {
			destroyed = true;
			void startup
				.then(() => destroySystems())
				.catch((error: unknown) =>
					console.error("Failed to shut down explorer systems.", error),
				);
		};
	});
</script>

<div class="explorer-screen">
	<canvas
		bind:this={canvasElement}
		class="explorer-canvas"
		aria-label="Explorer render viewport"
	></canvas>

	<div class="explorer-overlay">
		{#if startupError !== null}
			<section class="explorer-startup-error" role="alert">
				{startupError}
			</section>
		{/if}

		<FrameMetricsOverlay metrics={frameMetrics} />
		<ExplorerTools />
	</div>
</div>
