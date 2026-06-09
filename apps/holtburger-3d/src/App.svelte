<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import {
		describeBrowserDestinationIdentity,
		type BrowserModeState,
	} from "./app/browser-mode";
	import { frontendState } from "./app/frontend-state";
	import { AssetChannelController } from "./lib/assets/asset-channel";
	import { PreparedAssetStore } from "./lib/assets/prepared-asset-store";
	import { SceneAssetStreamingController } from "./lib/assets/scene-asset-streaming-controller";
	import "./lib/diagnostics/browser-js-profiler";
	import { readDebugConfig } from "./lib/host/tauri";
	import BrowserWorldDisplay from "./pages/BrowserWorldDisplay.svelte";

	const tauriLaunchCommand = "npm run tauri:dev";
	const currentRoute =
		typeof window === "undefined" ? "/browser" : window.location.pathname;
	const isBrowserRoute = currentRoute === "/" || currentRoute === "/browser";
	let startupError = $state<string | null>(null);
	let verboseDiagnostics = false;
	let currentSceneStreamer: SceneAssetStreamingController | null = null;
	const preparedAssetStore = new PreparedAssetStore();
	let latestFrontendState = $state(get(frontendState));

	onMount(() => {
		let dispose = () => {};
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
		currentSceneStreamer = sceneStreamer;

		let lastSceneInterestKey: string | null = null;
		const unsubscribeFrontendState = frontendState.subscribe((state) => {
			latestFrontendState = state;
			const sceneInterestKey = createBrowserSceneInterestKey(state.browserMode);
			if (sceneInterestKey === lastSceneInterestKey) {
				return;
			}
			lastSceneInterestKey = sceneInterestKey;
			syncSceneStreamer(sceneStreamer);
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
			unsubscribeFrontendState();
			dispose();
			sceneStreamer.dispose();
			currentSceneStreamer = null;
			assetChannel.dispose();
		};
	});

	function syncSceneStreamer(
		sceneStreamer: SceneAssetStreamingController,
	): void {
		sceneStreamer.syncSceneInterest({
			browserDestination: latestFrontendState.browserMode.destination,
			terrainLodRadius: latestFrontendState.browserMode.terrainLodRadius,
			buildingLodRadius: latestFrontendState.browserMode.buildingLodRadius,
			detailLodRadius: latestFrontendState.browserMode.detailLodRadius,
			envCellLodRadius: latestFrontendState.browserMode.envCellLodRadius,
		});
	}

	function createBrowserSceneInterestKey(browserMode: BrowserModeState): string {
		const destinationIdentity =
			describeBrowserDestinationIdentity(browserMode.destination) ?? "none";
		return [
			destinationIdentity,
			`terrain-${browserMode.terrainLodRadius}`,
			`buildings-${browserMode.buildingLodRadius}`,
			`detail-${browserMode.detailLodRadius}`,
			`env-cells-${browserMode.envCellLodRadius}`,
		].join(":");
	}

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
	{:else}
		<BrowserWorldDisplay preparedAssetResolver={preparedAssetStore.resolver} />
	{/if}
</main>
