<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { createBrowserSceneResourceController } from "./app/browser-scene-resource-controller";
	import { frontendState } from "./app/frontend-state";
	import { AssetChannelController } from "./lib/assets/asset-channel";
	import { PreparedAssetStore } from "./lib/assets/prepared-asset-store";
	import { SceneAssetStreamingController } from "./lib/assets/scene-asset-streaming-controller";
	import {
		createSceneResourceRuntime,
		type SceneResourceRuntime,
	} from "./lib/scene-runtime/scene-resource-runtime";
	import "./lib/diagnostics/browser-js-profiler";
	import { readDebugConfig } from "./lib/host/tauri";
	import { StaticLandblockRenderArtifactCoordinator } from "./lib/world-display/static-landblock-render-artifact-coordinator";
	import BrowserWorldDisplay from "./pages/BrowserWorldDisplay.svelte";

	const tauriLaunchCommand = "npm run tauri:dev";
	const currentRoute =
		typeof window === "undefined" ? "/browser" : window.location.pathname;
	const isBrowserRoute = currentRoute === "/" || currentRoute === "/browser";
	let startupError = $state<string | null>(null);
	let verboseDiagnostics = false;
	let sceneResourceRuntime = $state<SceneResourceRuntime | null>(null);
	const preparedAssetStore = new PreparedAssetStore();
	let latestFrontendState = $state(get(frontendState));

	onMount(() => {
		if (!isBrowserRoute) {
			return;
		}

		const assetChannel = new AssetChannelController();
		const sceneStreamer = new SceneAssetStreamingController({
			assetChannel,
			preparedAssetResolver: preparedAssetStore.resolver,
			markAssetsPending: (requests) =>
				frontendState.markAssetsPending(requests),
			applyPreparedAssets: (assets) => {
				preparedAssetStore.applyPreparedAssets(assets);
				frontendState.applyPreparedAssets(assets);
			},
			applyAssetCachePruneBatch: (prunePlan) => {
				preparedAssetStore.applyPruneBatch(prunePlan);
			},
			applyAssetError: (request, message) =>
				frontendState.applyAssetError(request, message),
			debugLog,
		});
		const landblockProductRuntime =
			new StaticLandblockRenderArtifactCoordinator({
				onError: (error, desired) => {
					console.error("[holtburger-3d][static-landblock-render-worker]", {
						landblockId: desired.landblockId,
						product: desired.product,
						requestId: desired.requestId,
						message: error.message,
					});
				},
			});
		const runtime = createSceneResourceRuntime({
			assets: sceneStreamer,
			landblockProducts: landblockProductRuntime,
		});
		sceneResourceRuntime = runtime;

		const browserSceneResourceController =
			createBrowserSceneResourceController({
				frontendState,
				runtime,
				onFrontendState: (state) => {
					latestFrontendState = state;
				},
			});

		void (async () => {
			try {
				const debugConfig = await readDebugConfig();
				verboseDiagnostics = debugConfig.verbose;
				debugLog("debug-config", debugConfig);
				startupError = null;
			} catch (error) {
				startupError = error instanceof Error ? error.message : String(error);
			}
		})();

		return () => {
			browserSceneResourceController.dispose();
			runtime.dispose();
			sceneResourceRuntime = null;
			assetChannel.dispose();
		};
	});

	function debugLog(label: string, detail: unknown): void {
		if (!verboseDiagnostics) {
			return;
		}

		console.debug(`[holtburger-3d][${label}]`, detail);
	}
</script>

<svelte:head>
	<title>Holtburger 3D World Viewer</title>
	<meta
		name="description"
		content="Tauri-backed browser scene viewer for Holtburger 3D with frontend-owned navigation and demand-driven terrain asset loading."
	/>
</svelte:head>

<main class="viewer-shell">
	{#if !isBrowserRoute}
		<section class="viewer-unavailable">
			<p class="kicker">Route Reserved</p>
			<h1>Client mode is not implemented yet.</h1>
			<p class="lede">Open /browser to use the standalone scene browser.</p>
		</section>
	{:else if startupError}
		<section class="viewer-unavailable">
			<p class="kicker">Tauri Required</p>
			<h1>{startupError}</h1>
			<p class="lede">
				Start the native app to access the asset channel used by the scene
				browser.
			</p>
			<pre>{tauriLaunchCommand}</pre>
		</section>
	{:else if !sceneResourceRuntime}
		<section class="viewer-unavailable">
			<p class="kicker">Scene Runtime</p>
			<h1>Preparing scene resources.</h1>
		</section>
	{:else}
		<BrowserWorldDisplay
			preparedAssetResolver={preparedAssetStore.resolver}
			staticLandblockProductSource={sceneResourceRuntime.landblockProducts.productSource}
		/>
	{/if}
</main>
