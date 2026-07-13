<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import ExplorerTools from "./ExplorerTools.svelte";
	import { GameRuntime } from "../lib/game/runtime/game-runtime";
	import { StandardCommitPipeline } from "../lib/game/commit/pipeline";
	import { WebGL2Device } from "../lib/game/renderer/webgl2-device";
	import { TauriAssetBridge } from "../lib/assets/tauri-asset-bridge";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
	let commitPipeline: StandardCommitPipeline | undefined;
	let webglDevice: WebGL2Device | undefined;
	let frameMetrics: FrameMetrics | null = $state(null);
	let startupError: string | null = $state(null);

	onMount(() => {
		if (canvasElement === null) {
			startupError = "Explorer canvas was not mounted.";
			return;
		}

		let destroyed = false;

		const start = async (): Promise<void> => {
			try {
				const hostAssets = TauriAssetBridge.build();
				webglDevice = await WebGL2Device.build(canvasElement!);
				commitPipeline = await StandardCommitPipeline.build(hostAssets);

				if (destroyed) {
					await commitPipeline.destroy();
					await webglDevice.destroy();
					return;
				}

				gameRuntime = GameRuntime.build(
					webglDevice.resources,
					webglDevice.renderer,
					commitPipeline,
				);

				const step = (): void => {
					if (gameRuntime === undefined) {
						frameMetrics = null;
						frameHandle = window.requestAnimationFrame(step);
						return;
					}

					const tickStartedAt = performance.now();
					gameRuntime.tick();
					const updateFrameStartedAt = performance.now();
					gameRuntime.updateFrame();
					const frameFinishedAt = performance.now();

					frameMetrics = {
						tickMs: updateFrameStartedAt - tickStartedAt,
						updateFrameMs: frameFinishedAt - updateFrameStartedAt,
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
			}
		};

		void start();

		return () => {
			destroyed = true;
		};
	});

	onDestroy(() => {
		if (frameHandle !== null) {
			window.cancelAnimationFrame(frameHandle);
			frameHandle = null;
		}

		void gameRuntime?.destroy();
		void commitPipeline?.destroy();
		void webglDevice?.destroy();
		gameRuntime = undefined;
		commitPipeline = undefined;
		webglDevice = undefined;
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
