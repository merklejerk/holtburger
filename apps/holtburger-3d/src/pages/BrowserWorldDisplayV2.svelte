<script lang="ts">
	import { onMount } from "svelte";
	import {
		DEFAULT_BUILDING_LOD_RADIUS,
		DEFAULT_DETAIL_LOD_RADIUS,
		DEFAULT_ENV_CELL_LOD_RADIUS,
		DEFAULT_TERRAIN_LOD_RADIUS,
		MAX_OUTDOOR_SCENE_LOD_RADIUS,
		MIN_OUTDOOR_SCENE_LOD_RADIUS,
		clampOutdoorSceneLodRadius,
		countOutdoorSceneLodTiles,
	} from "../lib/world-display/outdoor-scene-interest";
	import { V2BrowserCameraController } from "../v2/camera/browser-camera-controller";
	import {
		createV2FreeCameraFrameStateCamera,
		createV2FreeCameraState,
		type V2FreeCameraState,
	} from "../v2/camera/free-camera";
	import { createBrowserV2Runtime } from "../v2/browser/create-browser-v2-runtime";
	import {
		createStaticWorkCommandFromLocation,
		inferV2LandblockInputMode,
		isV2LandblockPrefixInput,
		parseV2LocationInput,
		type V2LandblockInputMode,
	} from "../v2/browser/location-input";
	import type {
		ClientRuntime,
		ManualStaticDomain,
		RuntimeSnapshot,
	} from "../v2/runtime/client-runtime";

	type BrowserV2PanelTab = "navigate" | "coverage" | "static" | "status";

	const STATIC_INTEREST_REFRESH_DEBOUNCE_MS = 250;
	const PERF_OVERLAY_SAMPLE_MS = 500;

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let rootElement: HTMLElement | null = $state(null);
	let runtime: ClientRuntime | null = $state(null);
	let cameraController: V2BrowserCameraController | null = null;
	let staticInterestRefreshTimer: number | null = null;
	let startupError = $state<string | null>(null);
	let activeTab = $state<BrowserV2PanelTab>("navigate");
	let panelCollapsed = $state(false);
	let locationInput = $state("0000");
	let landblockInputMode = $state<V2LandblockInputMode>("outdoor");
	let terrainEnabled = $state(true);
	let buildingsEnabled = $state(false);
	let detailEnabled = $state(false);
	let topologyEnabled = $state(false);
	let terrainRadius = $state(DEFAULT_TERRAIN_LOD_RADIUS);
	let buildingRadius = $state(DEFAULT_BUILDING_LOD_RADIUS);
	let detailRadius = $state(DEFAULT_DETAIL_LOD_RADIUS);
	let topologyRadius = $state(DEFAULT_ENV_CELL_LOD_RADIUS);
	let snapshot = $state<RuntimeSnapshot | null>(null);
	let cameraState = $state<V2FreeCameraState>(createV2FreeCameraState());
	let perfOverlay = $state({
		fps: 0,
		frameMs: 0,
		frameCount: 0,
	});
	let perfSample = {
		frameCount: 0,
		timeMs: 0,
	};
	const parsedLocation = $derived(
		parseV2LocationInput(locationInput, landblockInputMode),
	);
	const parsedIsInterior = $derived(parsedLocation?.kind === "interior-cell");
	const canToggleLandblockMode = $derived(
		isV2LandblockPrefixInput(locationInput),
	);

	onMount(() => {
		if (!canvasElement) {
			startupError = "V2 canvas was not mounted.";
			return;
		}

		try {
			runtime = createBrowserV2Runtime(canvasElement);
			cameraController = new V2BrowserCameraController({
				initialState: cameraState,
				onChange(nextCameraState) {
					cameraState = nextCameraState;
				},
			});
			const unsubscribe = runtime.subscribe((nextSnapshot) => {
				snapshot = nextSnapshot;
				updatePerfOverlay(nextSnapshot);
			});
			const frameInterval = window.setInterval(() => {
				runtime?.updateFrameState({
					camera:
						cameraController?.createFrameStateCamera() ??
						createV2FreeCameraFrameStateCamera(cameraState),
					timeSeconds: performance.now() / 1000,
				});
			}, 1000 / 30);

			return () => {
				window.clearInterval(frameInterval);
				clearStaticInterestRefresh();
				unsubscribe();
				cameraController?.dispose();
				cameraController = null;
				runtime?.dispose();
				runtime = null;
			};
		} catch (error) {
			startupError = error instanceof Error ? error.message : String(error);
		}
	});

	function requestStaticWork(): void {
		clearStaticInterestRefresh();
		if (!runtime || !parsedLocation) {
			return;
		}

		runtime.requestStaticWork(
			createStaticWorkCommandFromLocation(parsedLocation, selectedDomains(), {
				buildings: buildingRadius,
				detail: detailRadius,
				terrain: terrainRadius,
				topology: topologyRadius,
			}),
		);
	}

	function handleStaticWorkSubmit(event: SubmitEvent): void {
		event.preventDefault();
		requestStaticWork();
	}

	function evictStaticWork(): void {
		clearStaticInterestRefresh();
		runtime?.evictStaticWork();
	}

	function resetCamera(): void {
		cameraController?.reset();
	}

	function handleLocationInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		locationInput = input.value;
		landblockInputMode = inferV2LandblockInputMode(
			locationInput,
			landblockInputMode,
		);
		scheduleStaticInterestRefresh();
	}

	function handleTerrainRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const nextTerrainRadius = clampOutdoorSceneLodRadius(Number(input.value));
		terrainRadius = nextTerrainRadius;
		buildingRadius = Math.min(buildingRadius, nextTerrainRadius);
		detailRadius = Math.min(detailRadius, buildingRadius);
		topologyRadius = Math.min(topologyRadius, nextTerrainRadius);
		scheduleStaticInterestRefresh();
	}

	function handleBuildingRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const nextBuildingRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			terrainRadius,
		);
		buildingRadius = nextBuildingRadius;
		detailRadius = Math.min(detailRadius, nextBuildingRadius);
		scheduleStaticInterestRefresh();
	}

	function handleDetailRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		detailRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			buildingRadius,
		);
		scheduleStaticInterestRefresh();
	}

	function handleTopologyRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		topologyRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			terrainRadius,
		);
		scheduleStaticInterestRefresh();
	}

	function handleOutdoorModeChange(): void {
		landblockInputMode = "outdoor";
		scheduleStaticInterestRefresh();
	}

	function handleDungeonModeChange(): void {
		landblockInputMode = "dungeon";
		scheduleStaticInterestRefresh();
	}

	function handleStaticDomainChange(): void {
		scheduleStaticInterestRefresh();
	}

	function canRequestStaticWork(): boolean {
		if (!runtime || !parsedLocation) {
			return false;
		}

		return (
			parsedLocation.kind === "interior-cell" || selectedDomains().length > 0
		);
	}

	function selectedDomains(): ManualStaticDomain[] {
		const domains: ManualStaticDomain[] = [];

		if (terrainEnabled) {
			domains.push("terrain");
		}
		if (buildingsEnabled) {
			domains.push("buildings");
		}
		if (detailEnabled) {
			domains.push("detail");
		}
		if (topologyEnabled) {
			domains.push("topology");
		}

		return domains;
	}

	function togglePanelCollapsed(): void {
		panelCollapsed = !panelCollapsed;
	}

	function scheduleStaticInterestRefresh(): void {
		clearStaticInterestRefresh();
		if (!runtime || !parsedLocation || !canRequestStaticWork()) {
			return;
		}

		staticInterestRefreshTimer = window.setTimeout(() => {
			staticInterestRefreshTimer = null;
			requestStaticWork();
		}, STATIC_INTEREST_REFRESH_DEBOUNCE_MS);
	}

	function clearStaticInterestRefresh(): void {
		if (staticInterestRefreshTimer === null) {
			return;
		}

		window.clearTimeout(staticInterestRefreshTimer);
		staticInterestRefreshTimer = null;
	}

	function updatePerfOverlay(nextSnapshot: RuntimeSnapshot): void {
		const nowMs = performance.now();
		if (perfSample.timeMs === 0) {
			perfSample = {
				frameCount: nextSnapshot.renderer.frameCount,
				timeMs: nowMs,
			};
			perfOverlay = {
				...perfOverlay,
				frameCount: nextSnapshot.renderer.frameCount,
			};
			return;
		}

		const elapsedMs = nowMs - perfSample.timeMs;
		const frameDelta = nextSnapshot.renderer.frameCount - perfSample.frameCount;
		if (elapsedMs < PERF_OVERLAY_SAMPLE_MS || frameDelta <= 0) {
			perfOverlay = {
				...perfOverlay,
				frameCount: nextSnapshot.renderer.frameCount,
			};
			return;
		}

		perfOverlay = {
			fps: (frameDelta * 1000) / elapsedMs,
			frameCount: nextSnapshot.renderer.frameCount,
			frameMs: elapsedMs / frameDelta,
		};
		perfSample = {
			frameCount: nextSnapshot.renderer.frameCount,
			timeMs: nowMs,
		};
	}

	function formatCameraPosition(
		position: readonly [number, number, number],
	): string {
		return `${position[0].toFixed(1)}, ${position[1].toFixed(1)}, ${position[2].toFixed(1)}`;
	}

	function isControlPanelEvent(event: Event): boolean {
		return (
			event.target instanceof Element &&
			event.target.closest(".browser-v2__panel") !== null
		);
	}

	function handleViewportPointerDown(event: PointerEvent): void {
		if (!rootElement || isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handlePointerDown(event, rootElement)) {
			event.preventDefault();
		}
	}

	function handleViewportPointerMove(event: PointerEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handlePointerMove(event)) {
			event.preventDefault();
		}
	}

	function handleViewportPointerUp(event: PointerEvent): void {
		if (!rootElement || isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handlePointerUp(event, rootElement)) {
			event.preventDefault();
		}
	}

	function handleViewportWheel(event: WheelEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handleWheel(event)) {
			event.preventDefault();
		}
	}

	function handleViewportKeyDown(event: KeyboardEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (event.key.toLowerCase() === "f") {
			resetCamera();
			event.preventDefault();
			return;
		}

		if (cameraController?.handleKeyDown(event)) {
			event.preventDefault();
		}
	}

	function handleViewportKeyUp(event: KeyboardEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handleKeyUp(event)) {
			event.preventDefault();
		}
	}

	function handleViewportBlur(): void {
		cameraController?.handleBlur();
	}

	function handleViewportContextMenu(event: MouseEvent): void {
		if (!isControlPanelEvent(event)) {
			event.preventDefault();
		}
	}
</script>

<svelte:head>
	<title>Holtburger 3D V2 Harness</title>
	<meta
		name="description"
		content="V2 frontend harness for proving runtime, renderer, and static pipeline boundaries."
	/>
</svelte:head>

<section
	bind:this={rootElement}
	class="browser-v2"
	tabindex="-1"
	onblurcapture={handleViewportBlur}
	oncontextmenucapture={handleViewportContextMenu}
	onkeydowncapture={handleViewportKeyDown}
	onkeyupcapture={handleViewportKeyUp}
	onpointercancelcapture={handleViewportPointerUp}
	onpointerdowncapture={handleViewportPointerDown}
	onpointermovecapture={handleViewportPointerMove}
	onpointerupcapture={handleViewportPointerUp}
	onwheelcapture={handleViewportWheel}
>
	<canvas bind:this={canvasElement} class="browser-v2__canvas"></canvas>

	<div class="browser-v2__perf" aria-label="Renderer performance">
		<span>{perfOverlay.fps.toFixed(1)} FPS</span>
		<span>{perfOverlay.frameMs.toFixed(1)} ms</span>
		<span>f{perfOverlay.frameCount}</span>
	</div>

	<aside
		class:browser-v2__panel--collapsed={panelCollapsed}
		class="browser-v2__panel"
		aria-label="V2 runtime controls"
	>
		<div class="browser-v2__panel-bar">
			{#if !panelCollapsed}
				<header>
					<p class="kicker">Frontend V2</p>
					<h1>Runtime Harness</h1>
				</header>
			{/if}

			<button
				class="browser-v2__collapse"
				type="button"
				aria-expanded={!panelCollapsed}
				aria-label={panelCollapsed ? "Expand controls" : "Collapse controls"}
				title={panelCollapsed ? "Expand controls" : "Collapse controls"}
				onclick={togglePanelCollapsed}
			>
				{panelCollapsed ? "+" : "-"}
			</button>
		</div>

		{#if !panelCollapsed}
			{#if startupError}
				<p class="browser-v2__error">{startupError}</p>
			{/if}

			<div
				class="browser-v2__tabs"
				role="tablist"
				aria-label="V2 harness views"
			>
				<button
					class:active={activeTab === "navigate"}
					type="button"
					role="tab"
					aria-selected={activeTab === "navigate"}
					onclick={() => {
						activeTab = "navigate";
					}}
				>
					Navigate
				</button>
				<button
					class:active={activeTab === "static"}
					type="button"
					role="tab"
					aria-selected={activeTab === "static"}
					onclick={() => {
						activeTab = "static";
					}}
				>
					Static
				</button>
				<button
					class:active={activeTab === "coverage"}
					type="button"
					role="tab"
					aria-selected={activeTab === "coverage"}
					onclick={() => {
						activeTab = "coverage";
					}}
				>
					Coverage
				</button>
				<button
					class:active={activeTab === "status"}
					type="button"
					role="tab"
					aria-selected={activeTab === "status"}
					onclick={() => {
						activeTab = "status";
					}}
				>
					Status
				</button>
			</div>

			{#if activeTab === "navigate"}
				<div class="browser-v2__tab-panel" role="tabpanel">
					<form class="browser-v2__form" onsubmit={handleStaticWorkSubmit}>
						<label class="browser-v2__field">
							<span>Location</span>
							<input
								autocomplete="off"
								placeholder="33.50S, 72.80E, 0xda55, or 0xda550123"
								spellcheck="false"
								value={locationInput}
								oninput={handleLocationInput}
							/>
						</label>

						<div class="browser-v2__toggles" aria-label="Landblock focus mode">
							<label>
								<input
									checked={landblockInputMode === "outdoor"}
									disabled={!canToggleLandblockMode}
									name="browser-v2-landblock-mode"
									type="radio"
									onchange={handleOutdoorModeChange}
								/>
								<span>Outdoor</span>
							</label>
							<label>
								<input
									checked={landblockInputMode === "dungeon"}
									disabled={!canToggleLandblockMode}
									name="browser-v2-landblock-mode"
									type="radio"
									onchange={handleDungeonModeChange}
								/>
								<span>Dungeon</span>
							</label>
						</div>

						<dl class="browser-v2__status">
							<div>
								<dt>Parsed</dt>
								<dd>{parsedLocation?.label ?? "invalid"}</dd>
							</div>
							<div>
								<dt>Mode</dt>
								<dd>
									{parsedLocation?.kind === "interior-cell"
										? "interior cell"
										: parsedLocation?.kind === "outdoor-landblock"
											? "outdoor landblock"
											: "unknown"}
								</dd>
							</div>
							<div>
								<dt>Last request</dt>
								<dd>
									{#if snapshot?.lastStaticRequest}
										{snapshot.lastStaticRequest.landblockId}
										{#if snapshot.lastStaticRequest.envCellId}
											/ {snapshot.lastStaticRequest.envCellId}
										{/if}
										({snapshot.lastStaticRequest.domains.join(", ")})
									{:else}
										none
									{/if}
								</dd>
							</div>
						</dl>

						<button
							class="browser-v2__request"
							disabled={!canRequestStaticWork()}
							type="submit"
						>
							Request Static Scope
						</button>
					</form>
				</div>
			{:else if activeTab === "coverage"}
				<div class="browser-v2__tab-panel" role="tabpanel">
					<label class="browser-v2__range">
						<span>Terrain distance</span>
						<strong>
							{terrainRadius} out ({countOutdoorSceneLodTiles(terrainRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={MAX_OUTDOOR_SCENE_LOD_RADIUS}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={terrainRadius}
							oninput={handleTerrainRadiusInput}
						/>
					</label>

					<label class="browser-v2__range">
						<span>Building distance</span>
						<strong>
							{buildingRadius} out ({countOutdoorSceneLodTiles(buildingRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={terrainRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={buildingRadius}
							oninput={handleBuildingRadiusInput}
						/>
					</label>

					<label class="browser-v2__range">
						<span>Detail distance</span>
						<strong>
							{detailRadius} out ({countOutdoorSceneLodTiles(detailRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={buildingRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={detailRadius}
							oninput={handleDetailRadiusInput}
						/>
					</label>

					<label class="browser-v2__range">
						<span>Topology distance</span>
						<strong>
							{topologyRadius} out ({countOutdoorSceneLodTiles(topologyRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={terrainRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={topologyRadius}
							oninput={handleTopologyRadiusInput}
						/>
					</label>

					<dl class="browser-v2__status">
						<div>
							<dt>Coverage</dt>
							<dd>
								{parsedIsInterior
									? "single dungeon landblock"
									: `${countOutdoorSceneLodTiles(terrainRadius)} terrain tiles max`}
							</dd>
						</div>
					</dl>
				</div>
			{:else if activeTab === "static"}
				<div class="browser-v2__tab-panel" role="tabpanel">
					<div class="browser-v2__toggles" aria-label="Static domains">
						<label>
							<input
								bind:checked={terrainEnabled}
								disabled={parsedIsInterior}
								type="checkbox"
								onchange={handleStaticDomainChange}
							/>
							<span>Terrain</span>
						</label>
						<label>
							<input
								bind:checked={buildingsEnabled}
								disabled={parsedIsInterior}
								type="checkbox"
								onchange={handleStaticDomainChange}
							/>
							<span>Buildings</span>
						</label>
						<label>
							<input
								bind:checked={detailEnabled}
								disabled={parsedIsInterior}
								type="checkbox"
								onchange={handleStaticDomainChange}
							/>
							<span>Detail</span>
						</label>
						<label>
							<input
								bind:checked={topologyEnabled}
								disabled={parsedIsInterior}
								type="checkbox"
								onchange={handleStaticDomainChange}
							/>
							<span>Topology</span>
						</label>
					</div>

					<div class="browser-v2__actions">
						<button
							class="browser-v2__request"
							disabled={!canRequestStaticWork()}
							type="button"
							onclick={requestStaticWork}
						>
							Request Static Scope
						</button>
						<button disabled={!runtime} type="button" onclick={evictStaticWork}>
							Evict
						</button>
						<button disabled={!runtime} type="button" onclick={resetCamera}>
							Reset Camera
						</button>
					</div>

					<dl class="browser-v2__status">
						<div>
							<dt>Static</dt>
							<dd>
								{#if snapshot}
									r{snapshot.static.revision} req {snapshot.static.requested} res
									{snapshot.static.resolving} bake {snapshot.static.baking} commit
									{snapshot.static.committed}
								{:else}
									pending
								{/if}
							</dd>
						</div>
						<div>
							<dt>Terrain payload</dt>
							<dd>
								{#if snapshot?.static.latestTerrainPayload}
									lb {snapshot.static.latestTerrainPayload.landblockId
										.toString(16)
										.padStart(8, "0")} region
									{snapshot.static.latestTerrainPayload.regionNumber} mesh
									{snapshot.static.latestTerrainPayload.vertexCount}v/{snapshot
										.static.latestTerrainPayload.triangleCount}t tex
									{snapshot.static.latestTerrainPayload.textureUseCount} missing
									{snapshot.static.latestTerrainPayload.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
						</div>
						<div>
							<dt>Topology payload</dt>
							<dd>
								{#if snapshot?.static.latestLandblockTopologyPayload}
									lb {snapshot.static.latestLandblockTopologyPayload.landblockId
										.toString(16)
										.padStart(8, "0")}
									{snapshot.static.latestLandblockTopologyPayload
										.classification} cells
									{snapshot.static.latestLandblockTopologyPayload.envCellCount} visible
									{snapshot.static.latestLandblockTopologyPayload
										.visibleCellCount} links
									{snapshot.static.latestLandblockTopologyPayload
										.portalLinkCount} missing
									{snapshot.static.latestLandblockTopologyPayload
										.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
						</div>
						<div>
							<dt>Dungeon payload</dt>
							<dd>
								{#if snapshot?.static.latestDungeonPayload}
									lb {snapshot.static.latestDungeonPayload.landblockId
										.toString(16)
										.padStart(8, "0")} cells
									{snapshot.static.latestDungeonPayload.envCellCount} visible
									{snapshot.static.latestDungeonPayload.visibleCellCount} portals
									{snapshot.static.latestDungeonPayload.portalCount} missing
									{snapshot.static.latestDungeonPayload.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
						</div>
					</dl>
				</div>
			{:else}
				<div class="browser-v2__tab-panel" role="tabpanel">
					<dl class="browser-v2__status">
						<div>
							<dt>Status</dt>
							<dd>{snapshot?.status ?? "starting"}</dd>
						</div>
						<div>
							<dt>Resolver failure</dt>
							<dd>
								{snapshot?.static.latestResolverFailure?.message ?? "none"}
							</dd>
						</div>
						<div>
							<dt>Host</dt>
							<dd>{snapshot?.host.isAvailable ? "tauri" : "unavailable"}</dd>
						</div>
						<div>
							<dt>Assets</dt>
							<dd>
								{#if snapshot}
									p{snapshot.assets.pending.length} c{snapshot.assets.committed
										.length} f{snapshot.assets.failures.length}
								{:else}
									pending
								{/if}
							</dd>
						</div>
						<div>
							<dt>Renderer</dt>
							<dd>{snapshot?.renderer.backend ?? "none"}</dd>
						</div>
						<div>
							<dt>Camera</dt>
							<dd>
								{formatCameraPosition(cameraState.position)} yaw
								{cameraState.yawRadians.toFixed(2)} pitch
								{cameraState.pitchRadians.toFixed(2)}
							</dd>
						</div>
						<div>
							<dt>Draw units</dt>
							<dd>
								{snapshot
									? `${snapshot.renderer.staticDrawUnits} static / ${snapshot.renderer.terrainDrawUnits} terrain`
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Triangles</dt>
							<dd>{snapshot?.renderer.renderedTriangles ?? 0}</dd>
						</div>
						<div>
							<dt>Canvas</dt>
							<dd>
								{snapshot
									? `${snapshot.renderer.canvasWidth}x${snapshot.renderer.canvasHeight}`
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Frames</dt>
							<dd>{snapshot?.renderer.frameCount ?? 0}</dd>
						</div>
					</dl>
				</div>
			{/if}
		{/if}
	</aside>
</section>

<style>
	:global(body) {
		margin: 0;
		background: #050807;
	}

	.browser-v2 {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background:
			linear-gradient(rgba(75, 255, 173, 0.035) 1px, transparent 1px),
			linear-gradient(90deg, rgba(75, 255, 173, 0.025) 1px, transparent 1px),
			#050807;
		background-size:
			24px 24px,
			24px 24px,
			auto;
		color: #d9ffe8;
		font-family:
			"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
	}

	.browser-v2__canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.browser-v2__perf {
		position: absolute;
		top: 16px;
		left: 16px;
		z-index: 1;
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

	.browser-v2__panel {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 1;
		width: min(380px, calc(100vw - 32px));
		max-height: calc(100vh - 32px);
		overflow: auto;
		padding: 10px;
		border: 1px solid rgba(91, 255, 187, 0.58);
		border-radius: 6px;
		background:
			linear-gradient(180deg, rgba(9, 27, 23, 0.96), rgba(4, 12, 11, 0.94)),
			rgba(4, 12, 11, 0.94);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.75),
			0 18px 50px rgba(0, 0, 0, 0.55),
			0 0 36px rgba(57, 255, 170, 0.13);
	}

	.browser-v2__panel--collapsed {
		left: auto;
		right: 16px;
		width: auto;
		max-height: none;
		overflow: visible;
		padding: 6px;
	}

	.browser-v2__panel-bar {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}

	.browser-v2__panel--collapsed .browser-v2__panel-bar {
		margin-bottom: 0;
	}

	.browser-v2__panel header {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.kicker {
		margin: 0;
		color: #75ffd1;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	h1 {
		margin: 0;
		color: #f1fff6;
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0;
	}

	button,
	input {
		font: inherit;
	}

	.browser-v2 button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 30px;
		padding: 0 9px;
		border: 1px solid rgba(91, 255, 187, 0.45);
		border-radius: 4px;
		background: rgba(9, 38, 31, 0.92);
		color: #d9ffe8;
		cursor: pointer;
		font-size: 12px;
		line-height: 1;
		text-align: center;
		white-space: nowrap;
	}

	.browser-v2 button:hover:not(:disabled),
	.browser-v2 button.active {
		border-color: rgba(255, 214, 102, 0.9);
		color: #fff7cf;
		box-shadow: inset 0 0 18px rgba(255, 214, 102, 0.11);
	}

	.browser-v2 button:disabled,
	input:disabled {
		cursor: not-allowed;
		opacity: 0.48;
	}

	.browser-v2__collapse {
		flex: 0 0 auto;
		width: 30px;
		padding: 0;
		font-size: 15px;
		font-weight: 700;
	}

	.browser-v2__tabs {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 5px;
		margin-bottom: 10px;
	}

	.browser-v2__tabs button {
		min-height: 28px;
		padding: 0 6px;
		font-size: 11px;
	}

	.browser-v2__tab-panel {
		display: grid;
		gap: 9px;
		margin: 0;
	}

	.browser-v2__form {
		display: grid;
		gap: 9px;
		margin: 0;
	}

	.browser-v2__field,
	.browser-v2__range {
		display: grid;
		gap: 5px;
	}

	.browser-v2__field span,
	.browser-v2__range span {
		color: #75ffd1;
		font-size: 11px;
		text-transform: uppercase;
	}

	.browser-v2__field input {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid rgba(91, 255, 187, 0.48);
		border-radius: 4px;
		background: rgba(1, 9, 8, 0.9);
		color: #f1fff6;
		padding: 7px 9px;
		font-size: 12px;
		outline: none;
	}

	.browser-v2__field input:focus {
		border-color: #ffd666;
		box-shadow: 0 0 0 2px rgba(255, 214, 102, 0.16);
	}

	.browser-v2__toggles,
	.browser-v2__actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}

	.browser-v2__actions {
		grid-template-columns: 1fr 0.65fr 0.9fr;
	}

	.browser-v2__toggles label {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 28px;
		padding: 0 7px;
		border: 1px solid rgba(91, 255, 187, 0.28);
		border-radius: 4px;
		background: rgba(9, 38, 31, 0.48);
		font-size: 12px;
	}

	.browser-v2__range {
		padding: 8px;
		border: 1px solid rgba(91, 255, 187, 0.22);
		border-radius: 4px;
		background: rgba(1, 9, 8, 0.38);
	}

	.browser-v2__range strong {
		color: #fff7cf;
		font-size: 11px;
		font-weight: 600;
	}

	.browser-v2__range input {
		width: 100%;
		accent-color: #75ffd1;
	}

	.browser-v2__request {
		min-height: 32px;
		background: rgba(36, 68, 35, 0.82);
	}

	.browser-v2__status {
		display: grid;
		gap: 5px;
		margin: 0;
	}

	.browser-v2__status div {
		display: grid;
		grid-template-columns: minmax(88px, 0.42fr) minmax(0, 1fr);
		gap: 7px;
		padding: 6px 7px;
		border-left: 2px solid rgba(91, 255, 187, 0.42);
		background: rgba(1, 9, 8, 0.42);
	}

	.browser-v2__status dt {
		color: #75ffd1;
		font-size: 11px;
		text-transform: uppercase;
	}

	.browser-v2__status dd {
		margin: 0;
		color: #f1fff6;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.browser-v2__error {
		margin: 0 0 12px;
		padding: 7px;
		border: 1px solid rgba(255, 112, 112, 0.55);
		border-radius: 4px;
		background: rgba(61, 10, 10, 0.62);
		color: #ffd2d2;
		font-size: 12px;
	}

	@media (max-width: 720px) {
		.browser-v2__panel {
			left: 10px;
			right: 10px;
			top: 10px;
			width: auto;
			max-height: calc(100vh - 20px);
		}

		.browser-v2__panel--collapsed {
			left: auto;
			right: 10px;
			width: auto;
			max-height: none;
		}

		.browser-v2__tabs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.browser-v2__actions,
		.browser-v2__toggles {
			grid-template-columns: 1fr;
		}

		.browser-v2__status div {
			grid-template-columns: 1fr;
		}
	}
</style>
