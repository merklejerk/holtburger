<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { frontendState } from "./app/frontend-state";
	import { AssetChannelController } from "./lib/assets/asset-channel";
	import { SceneAssetStreamingController } from "./lib/assets/scene-asset-streaming-controller";
	import { readDebugConfig } from "./lib/host/tauri";
	import BrowserWorldDisplay from "./pages/BrowserWorldDisplay.svelte";

	const tauriLaunchCommand = "npm run tauri:dev";
	const currentRoute =
		typeof window === "undefined" ? "/browser" : window.location.pathname;
	const isBrowserRoute = currentRoute === "/" || currentRoute === "/browser";
	let startupError = $state<string | null>(null);
	let verboseDiagnostics = false;

	onMount(() => {
		let dispose = () => {};
		const assetChannel = new AssetChannelController();
		const sceneStreamer = new SceneAssetStreamingController({
			assetChannel,
			getPreparedByAssetId: () => get(frontendState).asset.preparedByAssetId,
			getCacheMetadataByAssetId: () =>
				get(frontendState).asset.cacheMetadataByAssetId,
			markAssetsPending: (requests) =>
				frontendState.markAssetsPending(requests),
			applyPreparedAssets: (assets) =>
				frontendState.applyPreparedAssets(assets),
			applyAssetCachePrune: (prunePlan) =>
				frontendState.applyAssetCachePrune(prunePlan),
			applyAssetError: (request, message) =>
				frontendState.applyAssetError(request, message),
			debugLog,
		});

		const unsubscribeFrontendState = frontendState.subscribe((state) => {
			sceneStreamer.syncSceneInterest({
				browserDestination: state.browserMode.destination,
				terrainLodRadius: state.browserMode.terrainLodRadius,
				buildingLodRadius: state.browserMode.buildingLodRadius,
				detailLodRadius: state.browserMode.detailLodRadius,
				envCellLodRadius: state.browserMode.envCellLodRadius,
				preparedByAssetId: state.asset.preparedByAssetId,
			});
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
	{:else}
		<BrowserWorldDisplay
			assetState={$frontendState.asset}
			browserDestination={$frontendState.browserMode.destination}
			terrainLodRadius={$frontendState.browserMode.terrainLodRadius}
			buildingLodRadius={$frontendState.browserMode.buildingLodRadius}
			detailLodRadius={$frontendState.browserMode.detailLodRadius}
			envCellLodRadius={$frontendState.browserMode.envCellLodRadius}
			transitionPortalMaxDepth={$frontendState.browserMode
				.transitionPortalMaxDepth}
			showPortalPolygons={$frontendState.browserMode.showPortalPolygons}
			showCellIndicators={$frontendState.browserMode.showCellIndicators}
			highlightPortalTargets={$frontendState.browserMode.highlightPortalTargets}
		/>
	{/if}
</main>
