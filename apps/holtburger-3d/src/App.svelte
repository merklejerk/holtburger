<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { frontendState } from "./app/frontend-state";
	import { AssetChannelController } from "./lib/assets/asset-channel";
	import { SceneAssetStreamingController } from "./lib/assets/scene-asset-streaming-controller";
	import {
		listenForRuntimeLifecycle,
		readDebugConfig,
		readHostBoundarySnapshot,
	} from "./lib/host/tauri";
	import BrowserWorldDisplay from "./pages/BrowserWorldDisplay.svelte";

	const tauriLaunchCommand = "npm run tauri:dev";
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
			const runtimeBatch = state.host.boundarySnapshot?.runtimeBatch ?? null;
			sceneStreamer.syncSceneInterest({
				runtimeBatch,
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

				dispose = await listenForRuntimeLifecycle((notification) => {
					debugLog("runtime-notification", {
						topic: notification.topic,
						tick: notification.runtimeBatch?.tick ?? null,
					});
					frontendState.applyRuntimeNotification(notification);
				});

				const snapshot = await readHostBoundarySnapshot();
				debugLog("snapshot", {
					tick: snapshot.runtimeBatch.tick,
					runtimeFocus: snapshot.runtimeBatch.residency.focusLocationLabel,
					draftDestination:
						$frontendState.browserMode.destination?.label ?? null,
				});
				frontendState.loadSnapshot(snapshot);
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
		content="Tauri-backed world viewer for Holtburger 3D with authoritative runtime lifecycle and demand-driven terrain asset loading."
	/>
</svelte:head>

<main class="viewer-shell">
	{#if $frontendState.host.boundarySnapshot}
		<BrowserWorldDisplay
			activeMode={$frontendState.mode.activeMode}
			activeModeLabel={$frontendState.mode.activeModeLabel}
			hostStatus={$frontendState.host.boundaryStatus}
			runtimeBatch={$frontendState.host.boundarySnapshot?.runtimeBatch ?? null}
			viewModelFeed={$frontendState.host.boundarySnapshot?.viewModelFeed ??
				null}
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
	{:else}
		<section class="viewer-unavailable">
			<p class="kicker">Tauri Required</p>
			<h1>{startupError ?? "World viewer failed before startup completed."}</h1>
			<p class="lede">
				Start the native app to access the live host boundary, terrain asset
				channel, and authoritative runtime lifecycle.
			</p>
			<pre>{tauriLaunchCommand}</pre>
		</section>
	{/if}
</main>
