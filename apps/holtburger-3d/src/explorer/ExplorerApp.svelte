<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import ExplorerTools from "./ExplorerTools.svelte";
	import { GameRuntime } from "../lib/game/runtime/game-runtime";
	import { WebGL2Renderer } from "../lib/game/renderer/webgl2-renderer";
	import { StandardCommitPipeline } from "../lib/game/commit/pipeline";
	import { WebGL2ResourceManager } from "../lib/game/renderer/webgl2-resource-manager";
	import { TauriAssetBridge } from "../lib/assets/tauri-asset-bridge";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
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
				const renderer = await WebGL2Renderer.build(canvasElement!);
				const renderResources = await WebGL2ResourceManager.build();
				const commitPipeline = await StandardCommitPipeline.build(hostAssets);

				if (destroyed) {
					await gameRuntime?.destroy();
					await renderer.destroy();
					await commitPipeline.destroy();
					await renderResources.destroy();
					return;
				}

				gameRuntime = GameRuntime.build(
					renderResources,
					renderer,
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

		gameRuntime?.destroy();
		gameRuntime = undefined;
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
