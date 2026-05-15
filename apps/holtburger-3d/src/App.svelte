<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { frontendState } from "./app/frontend-state";
	import {
		AssetChannelController,
		createSceneCoverageRequests,
	} from "./lib/assets/asset-channel";
	import {
		classifyAssetHydration,
		isSceneCoverageAssetId,
	} from "./lib/assets/asset-hydration-policy";
	import {
		listenForRuntimeLifecycle,
		readDebugConfig,
		readHostBoundarySnapshot,
	} from "./lib/host/tauri";
	import type { AssetPriority, RuntimeBatchDto } from "./lib/host/contracts";
	import BrowserWorldDisplay from "./pages/BrowserWorldDisplay.svelte";
	import BrowserModePage from "./pages/BrowserModePage.svelte";

	const tauriLaunchCommand = "npm run tauri:dev";
	let startupError = $state<string | null>(null);
	let verboseDiagnostics = false;

	onMount(() => {
		let dispose = () => {};
		let disposed = false;
		const assetChannel = new AssetChannelController();
		const inFlightAssetIds = new Set<string>();
		let lastBrowserCoverageKey: string | null = null;

		async function syncSceneCoverage(
			runtimeBatch: RuntimeBatchDto | null,
			browserDestination: typeof $frontendState.browserMode.destination,
			landblockCoverageRadius: number,
			structuredInteriorMaxEnvCells: number,
			structuredInteriorMaxVisibleCellDepth: number,
			priority: AssetPriority,
		): Promise<void> {
			const assetState = get(frontendState).asset;
			const requests = createSceneCoverageRequests(
				runtimeBatch,
				browserDestination,
				priority,
				assetState.preparedByAssetId,
				[...inFlightAssetIds],
				{
					landblockRadius: landblockCoverageRadius,
					structuredInterior: {
						maxEnvCells: structuredInteriorMaxEnvCells,
						maxVisibleCellDepth: structuredInteriorMaxVisibleCellDepth,
					},
				},
			);

			debugLog("scene-coverage", {
				priority,
				tick: runtimeBatch?.tick ?? null,
				destination: browserDestination?.label ?? null,
				landblockCoverageRadius,
				structuredInteriorMaxEnvCells,
				structuredInteriorMaxVisibleCellDepth,
				preparedCount: Object.keys(assetState.preparedByAssetId).length,
				inFlightAssetIds: [...inFlightAssetIds],
				requestAssetIds: requests.map((request) => request.assetId),
			});

			if (requests.length === 0) {
				return;
			}

			for (const request of requests) {
				inFlightAssetIds.add(request.assetId);
			}
			frontendState.markAssetsPending(requests);

			await Promise.allSettled(
				requests.map(async (request) => {
					debugLog("asset-request", request);
					try {
						const preparedAssets =
							classifyAssetHydration(request.assetId) === "direct"
								? [await assetChannel.prepareAsset(request)]
								: (
										await assetChannel.prepareAssetGraph(request, {
											...get(frontendState).asset.preparedByAssetId,
										})
									).preparedAssets;
						debugLog("asset-prepared", {
							rootAssetId: request.assetId,
							preparedAssetIds: preparedAssets.map(
								(asset) => asset.request.assetId,
							),
						});
						if (!disposed) {
							for (const preparedAsset of preparedAssets) {
								const invalidPolygons =
									preparedAsset.payload.kind === "gfx-obj"
										? preparedAsset.payload.renderGeometry.invalidPolygons
										: undefined;
								debugLog("asset-apply", {
									assetId: preparedAsset.request.assetId,
									kind: preparedAsset.payload.kind,
									invalidPolygons,
								});
							}
							frontendState.applyPreparedAssets(preparedAssets);
						}
					} catch (error) {
						debugLog("asset-error", {
							request,
							message: error instanceof Error ? error.message : String(error),
						});
						if (!disposed) {
							frontendState.applyAssetError(
								request,
								error instanceof Error ? error.message : String(error),
							);
						}
					} finally {
						inFlightAssetIds.delete(request.assetId);
					}
				}),
			);
		}

		const unsubscribeFrontendState = frontendState.subscribe((state) => {
			const runtimeBatch = state.host.boundarySnapshot?.runtimeBatch ?? null;
			const destination = state.browserMode.destination;
			const landblockCoverageRadius = state.browserMode.landblockCoverageRadius;
			const structuredInteriorMaxEnvCells =
				state.browserMode.structuredInteriorMaxEnvCells;
			const structuredInteriorMaxVisibleCellDepth =
				state.browserMode.structuredInteriorMaxVisibleCellDepth;
			const preparedSceneAssetKey = Object.keys(state.asset.preparedByAssetId)
				.filter(isSceneCoverageAssetId)
				.sort()
				.join(",");
			const coverageKey = destination
				? `${destination.source}:${destination.label}:radius-${landblockCoverageRadius}:interior-cells-${structuredInteriorMaxEnvCells}:interior-depth-${structuredInteriorMaxVisibleCellDepth}:prepared-${preparedSceneAssetKey}`
				: `runtime:radius-${landblockCoverageRadius}:interior-cells-${structuredInteriorMaxEnvCells}:interior-depth-${structuredInteriorMaxVisibleCellDepth}:prepared-${preparedSceneAssetKey}`;

			if (!runtimeBatch || coverageKey === lastBrowserCoverageKey) {
				return;
			}

			lastBrowserCoverageKey = coverageKey;
			debugLog("coverage-key", {
				coverageKey,
				destination: destination?.label ?? null,
				landblockCoverageRadius,
				structuredInteriorMaxEnvCells,
				structuredInteriorMaxVisibleCellDepth,
				runtimeTick: runtimeBatch.tick,
			});
			void syncSceneCoverage(
				runtimeBatch,
				destination,
				landblockCoverageRadius,
				structuredInteriorMaxEnvCells,
				structuredInteriorMaxVisibleCellDepth,
				"bootstrap",
			);
			void syncSceneCoverage(
				runtimeBatch,
				destination,
				landblockCoverageRadius,
				structuredInteriorMaxEnvCells,
				structuredInteriorMaxVisibleCellDepth,
				"streaming",
			);
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
					if (notification.runtimeBatch) {
						void syncSceneCoverage(
							notification.runtimeBatch,
							$frontendState.browserMode.destination,
							$frontendState.browserMode.landblockCoverageRadius,
							$frontendState.browserMode.structuredInteriorMaxEnvCells,
							$frontendState.browserMode.structuredInteriorMaxVisibleCellDepth,
							"streaming",
						);
					}
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
			disposed = true;
			unsubscribeFrontendState();
			dispose();
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
			landblockCoverageRadius={$frontendState.browserMode
				.landblockCoverageRadius}
			structuredInteriorMaxEnvCells={$frontendState.browserMode
				.structuredInteriorMaxEnvCells}
			structuredInteriorMaxVisibleCellDepth={$frontendState.browserMode
				.structuredInteriorMaxVisibleCellDepth}
		/>

		<div class="viewer-overlay viewer-overlay--right">
			<BrowserModePage />
		</div>
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
