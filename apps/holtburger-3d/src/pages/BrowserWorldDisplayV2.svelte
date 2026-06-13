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
	import { createBrowserStaticPickRay } from "../v2/browser/static-picking";
	import {
		createStaticWorkCommandFromLocation,
		inferV2LandblockInputMode,
		isV2LandblockPrefixInput,
		parseV2LocationInput,
		type V2LandblockInputMode,
		type V2ParsedLocationInput,
	} from "../v2/browser/location-input";
	import type {
		ClientRuntime,
		ManualStaticDomain,
		RuntimeSnapshot,
	} from "../v2/runtime/client-runtime";
	import type { StaticScenePickHit } from "../v2/runtime/static-scene-query";
	import type { TextureFilteringMode } from "../v2/textures/sampling-policy";
	import PerformanceOverlay from "../v2/ui/PerformanceOverlay.svelte";
	import {
		PerformanceMetricsTracker,
		type PerformanceMetricsSnapshot,
	} from "../v2/ui/performance-metrics";

	type BrowserV2PanelTab = "navigate" | "settings" | "debug";

	const STATIC_INTEREST_REFRESH_DEBOUNCE_MS = 250;
	const PERF_OVERLAY_SAMPLE_MS = 500;
	const PERF_OVERLAY_EMA_ALPHA = 0.18;
	const STATIC_PICK_CLICK_DRAG_THRESHOLD_PX = 3;
	const TEXTURE_FILTERING_OPTIONS: readonly TextureFilteringMode[] = [
		"nearest",
		"linear",
		"anisotropic-4x",
	];

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
	let submittedStaticLocation = $state<V2ParsedLocationInput | null>(null);
	let terrainEnabled = $state(true);
	let buildingsEnabled = $state(true);
	let detailEnabled = $state(true);
	let envCellsEnabled = $state(true);
	let terrainRadius = $state(DEFAULT_TERRAIN_LOD_RADIUS);
	let buildingRadius = $state(DEFAULT_BUILDING_LOD_RADIUS);
	let detailRadius = $state(DEFAULT_DETAIL_LOD_RADIUS);
	let envCellRadius = $state(DEFAULT_ENV_CELL_LOD_RADIUS);
	let snapshot = $state<RuntimeSnapshot | null>(null);
	let cameraState = $state<V2FreeCameraState>(createV2FreeCameraState());
	let diagnosticsReportText = $state<string | null>(null);
	let selectedStaticPick = $state<StaticScenePickHit | null>(null);
	let pickPointerCandidate: {
		readonly pointerId: number;
		readonly startX: number;
		readonly startY: number;
		readonly context: V2ParsedLocationInput | null;
		moved: boolean;
	} | null = null;
	let diagnosticsReportCopyStatus = $state<"copied" | "failed" | "ready">(
		"ready",
	);
	let selectedTextureFilteringMode =
		$state<TextureFilteringMode>("anisotropic-4x");
	let performanceMetrics = $state<PerformanceMetricsSnapshot>({
		fps: 0,
		frameMs: 0,
		handlerMs: 0,
	});
	const performanceMetricsTracker = new PerformanceMetricsTracker({
		emaAlpha: PERF_OVERLAY_EMA_ALPHA,
		sampleMs: PERF_OVERLAY_SAMPLE_MS,
	});
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
				selectedTextureFilteringMode =
					nextSnapshot.renderPolicy.textureFilteringMode;
				performanceMetrics = performanceMetricsTracker.update(
					nextSnapshot.renderer,
				);
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

		submittedStaticLocation = parsedLocation;
		selectedStaticPick = null;
		requestStaticWorkForLocation(parsedLocation);
	}

	function requestStaticWorkForLocation(location: V2ParsedLocationInput): void {
		if (!runtime) {
			return;
		}

		runtime.requestStaticWork(
			createStaticWorkCommandFromLocation(location, selectedDomains(), {
				buildings: buildingRadius,
				detail: detailRadius,
				terrain: terrainRadius,
				envCells: envCellRadius,
			}),
		);
	}

	function handleStaticWorkSubmit(event: SubmitEvent): void {
		event.preventDefault();
		requestStaticWork();
	}

	function evictStaticWork(): void {
		clearStaticInterestRefresh();
		submittedStaticLocation = null;
		selectedStaticPick = null;
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
	}

	function handleTerrainRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const nextTerrainRadius = clampOutdoorSceneLodRadius(Number(input.value));
		terrainRadius = nextTerrainRadius;
		buildingRadius = Math.min(buildingRadius, nextTerrainRadius);
		detailRadius = Math.min(detailRadius, buildingRadius);
		envCellRadius = Math.min(envCellRadius, nextTerrainRadius);
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

	function handleEnvCellRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		envCellRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			terrainRadius,
		);
		scheduleStaticInterestRefresh();
	}

	function handleOutdoorModeChange(): void {
		landblockInputMode = "outdoor";
	}

	function handleDungeonModeChange(): void {
		landblockInputMode = "dungeon";
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
		if (envCellsEnabled) {
			domains.push("env-cells");
		}

		return domains;
	}

	function togglePanelCollapsed(): void {
		panelCollapsed = !panelCollapsed;
	}

	function openDiagnosticsReport(): void {
		if (!runtime) {
			return;
		}

		diagnosticsReportText = JSON.stringify(
			runtime.createDiagnosticsReport(),
			null,
			2,
		);
		diagnosticsReportCopyStatus = "ready";
	}

	function closeDiagnosticsReport(): void {
		diagnosticsReportText = null;
		diagnosticsReportCopyStatus = "ready";
	}

	function setTextureFilteringMode(event: Event): void {
		const nextMode = (event.currentTarget as HTMLSelectElement)
			.value as TextureFilteringMode;
		selectedTextureFilteringMode = nextMode;
		runtime?.setTextureFilteringMode(nextMode);
	}

	async function copyDiagnosticsReport(): Promise<void> {
		if (diagnosticsReportText === null) {
			return;
		}

		try {
			if (navigator.clipboard) {
				await navigator.clipboard.writeText(diagnosticsReportText);
			} else {
				copyTextWithSelectionFallback(diagnosticsReportText);
			}
			diagnosticsReportCopyStatus = "copied";
		} catch {
			diagnosticsReportCopyStatus = "failed";
		}
	}

	function copyTextWithSelectionFallback(text: string): void {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.position = "fixed";
		textarea.style.left = "-9999px";
		textarea.setAttribute("readonly", "");
		document.body.appendChild(textarea);
		textarea.select();
		const copied = document.execCommand("copy");
		textarea.remove();
		if (!copied) {
			throw new Error("Clipboard fallback copy failed.");
		}
	}

	function scheduleStaticInterestRefresh(): void {
		clearStaticInterestRefresh();
		if (!runtime || !submittedStaticLocation) {
			return;
		}

		if (
			submittedStaticLocation.kind !== "interior-cell" &&
			selectedDomains().length === 0
		) {
			return;
		}

		staticInterestRefreshTimer = window.setTimeout(() => {
			staticInterestRefreshTimer = null;
			if (submittedStaticLocation) {
				requestStaticWorkForLocation(submittedStaticLocation);
			}
		}, STATIC_INTEREST_REFRESH_DEBOUNCE_MS);
	}

	function clearStaticInterestRefresh(): void {
		if (staticInterestRefreshTimer === null) {
			return;
		}

		window.clearTimeout(staticInterestRefreshTimer);
		staticInterestRefreshTimer = null;
	}

	function formatCameraPosition(
		position: readonly [number, number, number],
	): string {
		return `${position[0].toFixed(1)}, ${position[1].toFixed(1)}, ${position[2].toFixed(1)}`;
	}

	function isControlPanelEvent(event: Event): boolean {
		return (
			event.target instanceof Element &&
			(event.target.closest(".browser-v2__panel") !== null ||
				event.target.closest(".browser-v2__modal-backdrop") !== null)
		);
	}

	function handleViewportPointerDown(event: PointerEvent): void {
		if (!rootElement || isControlPanelEvent(event)) {
			return;
		}

		if (event.button === 0) {
			pickPointerCandidate = {
				context: submittedStaticLocation,
				moved: false,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
			};
		}

		if (cameraController?.handlePointerDown(event, rootElement)) {
			event.preventDefault();
		}
	}

	function handleViewportPointerMove(event: PointerEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		updatePickPointerCandidate(event);

		if (cameraController?.handlePointerMove(event)) {
			event.preventDefault();
		}
	}

	function handleViewportPointerUp(event: PointerEvent): void {
		if (!rootElement || isControlPanelEvent(event)) {
			return;
		}

		const pickCandidate = pickPointerCandidate;
		pickPointerCandidate = null;
		if (cameraController?.handlePointerUp(event, rootElement)) {
			event.preventDefault();
		}
		if (pickCandidate && shouldPickFromPointerUp(event, pickCandidate)) {
			pickStaticAtPointer(event, pickCandidate.context);
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
		pickPointerCandidate = null;
	}

	function handleViewportContextMenu(event: MouseEvent): void {
		if (!isControlPanelEvent(event)) {
			event.preventDefault();
		}
	}

	function updatePickPointerCandidate(event: PointerEvent): void {
		if (
			!pickPointerCandidate ||
			pickPointerCandidate.pointerId !== event.pointerId
		) {
			return;
		}

		const distance = Math.hypot(
			event.clientX - pickPointerCandidate.startX,
			event.clientY - pickPointerCandidate.startY,
		);
		if (distance > STATIC_PICK_CLICK_DRAG_THRESHOLD_PX) {
			pickPointerCandidate.moved = true;
		}
	}

	function shouldPickFromPointerUp(
		event: PointerEvent,
		candidate: NonNullable<typeof pickPointerCandidate>,
	): boolean {
		return (
			event.pointerId === candidate.pointerId &&
			event.button === 0 &&
			!candidate.moved
		);
	}

	function pickStaticAtPointer(
		event: PointerEvent,
		contextLocation: V2ParsedLocationInput | null,
	): void {
		if (!runtime || !canvasElement || !contextLocation) {
			selectedStaticPick = null;
			return;
		}

		const context =
			contextLocation.kind === "interior-cell"
				? {
						envCellId: contextLocation.envCellId,
						kind: "env-cell" as const,
						landblockId: contextLocation.landblockId,
					}
				: { kind: "outdoor" as const };
		selectedStaticPick = runtime.pickStaticRay(
			createBrowserStaticPickRay({
				camera:
					cameraController?.createFrameStateCamera() ??
					createV2FreeCameraFrameStateCamera(cameraState),
				clientX: event.clientX,
				clientY: event.clientY,
				context,
				viewport: canvasElement.getBoundingClientRect(),
			}),
		);
	}

	function formatStaticPickSummary(hit: StaticScenePickHit | null): string {
		if (!hit) {
			return "none";
		}

		if (hit.itemKind === "outdoor-static-object") {
			return `${hit.domain} ${hit.objectKind} ${hit.instanceId} ${hit.source.sourceAssetKind}:${formatHexId(hit.source.sourceDid)} d=${hit.distance.toFixed(2)} bvh ${hit.bvhItemIndex}`;
		}

		return `env-cell ${formatHexId(hit.envCellId)} ${hit.instanceId} ${hit.source.sourceAssetKind}:${formatHexId(hit.source.sourceDid)} d=${hit.distance.toFixed(2)}`;
	}

	function formatHexId(value: number): string {
		return `0x${value.toString(16).padStart(8, "0")}`;
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

	<PerformanceOverlay metrics={performanceMetrics} />

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
					aria-label="Navigate"
					title="Navigate"
					onclick={() => {
						activeTab = "navigate";
					}}
				>
					<span aria-hidden="true">⌖</span>
				</button>
				<button
					class:active={activeTab === "settings"}
					type="button"
					role="tab"
					aria-selected={activeTab === "settings"}
					aria-label="Settings"
					title="Settings"
					onclick={() => {
						activeTab = "settings";
					}}
				>
					<span aria-hidden="true">⚙</span>
				</button>
				<button
					class:active={activeTab === "debug"}
					type="button"
					role="tab"
					aria-selected={activeTab === "debug"}
					aria-label="Debug"
					title="Debug"
					onclick={() => {
						activeTab = "debug";
					}}
				>
					<span aria-hidden="true">◌</span>
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
			{:else if activeTab === "settings"}
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
								bind:checked={envCellsEnabled}
								disabled={parsedIsInterior}
								type="checkbox"
								onchange={handleStaticDomainChange}
							/>
							<span>Env Cells</span>
						</label>
					</div>

					<label class="browser-v2__field">
						<span>Filtering</span>
						<select
							bind:value={selectedTextureFilteringMode}
							disabled={!runtime}
							onchange={setTextureFilteringMode}
						>
							{#each TEXTURE_FILTERING_OPTIONS as option}
								<option value={option}>{option}</option>
							{/each}
						</select>
					</label>

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
						<span>Env-cell distance</span>
						<strong>
							{envCellRadius} out ({countOutdoorSceneLodTiles(envCellRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={terrainRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={envCellRadius}
							oninput={handleEnvCellRadiusInput}
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

					<div class="browser-v2__actions browser-v2__actions--single">
						<button disabled={!runtime} type="button" onclick={evictStaticWork}>
							Evict
						</button>
						<button disabled={!runtime} type="button" onclick={resetCamera}>
							Reset Camera
						</button>
					</div>
				</div>
			{:else}
				<div class="browser-v2__tab-panel" role="tabpanel">
					<div class="browser-v2__actions browser-v2__actions--single">
						<button
							disabled={!runtime}
							type="button"
							onclick={openDiagnosticsReport}
						>
							Diagnostics Report
						</button>
					</div>

					<dl class="browser-v2__status">
						<div>
							<dt>Filtering</dt>
							<dd>
								{snapshot?.renderPolicy.textureFilteringMode ?? "starting"}
							</dd>
						</div>
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
							<dt>Scene query</dt>
							<dd>
								{#if snapshot}
									out {snapshot.staticSceneQuery.outdoorRecordCount} env
									{snapshot.staticSceneQuery.envCellRecordCount} lb
									{snapshot.staticSceneQuery.envCellLandblockCount}
								{:else}
									pending
								{/if}
							</dd>
						</div>
						<div>
							<dt>Selected static</dt>
							<dd>{formatStaticPickSummary(selectedStaticPick)}</dd>
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
							<dt>Env-cell payload</dt>
							<dd>
								{#if snapshot?.static.latestLandblockEnvCellsPayload}
									lb {snapshot.static.latestLandblockEnvCellsPayload.landblockId
										.toString(16)
										.padStart(8, "0")}
									cells
									{snapshot.static.latestLandblockEnvCellsPayload.envCellCount}
									accepted
									{snapshot.static.latestLandblockEnvCellsPayload
										.acceptedEnvCellCount} visible
									{snapshot.static.latestLandblockEnvCellsPayload
										.visibleCellCount} portals
									{snapshot.static.latestLandblockEnvCellsPayload.portalCount}
									links
									{snapshot.static.latestLandblockEnvCellsPayload
										.portalLinkCount}
									seeds
									{snapshot.static.latestLandblockEnvCellsPayload
										.staticObjectSeedCount} missing
									{snapshot.static.latestLandblockEnvCellsPayload
										.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
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
							<dt>Frame handler</dt>
							<dd>
								{snapshot
									? `${snapshot.renderer.frameHandlerMs.toFixed(2)} ms`
									: "pending"}
							</dd>
						</div>
					</dl>
				</div>
			{/if}
		{/if}
	</aside>

	{#if diagnosticsReportText !== null}
		<div class="browser-v2__modal-backdrop">
			<div
				class="browser-v2__diagnostics-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="browser-v2-diagnostics-title"
			>
				<div class="browser-v2__diagnostics-header">
					<div>
						<p>On-demand diagnostics</p>
						<h2 id="browser-v2-diagnostics-title">Runtime Report</h2>
					</div>
					<button type="button" onclick={closeDiagnosticsReport}>Close</button>
				</div>
				<textarea readonly spellcheck="false" value={diagnosticsReportText}
				></textarea>
				<div class="browser-v2__diagnostics-actions">
					<span>
						{diagnosticsReportCopyStatus === "copied"
							? "Copied."
							: diagnosticsReportCopyStatus === "failed"
								? "Copy failed."
								: "Ready to copy."}
					</span>
					<button type="button" onclick={() => void copyDiagnosticsReport()}>
						Copy
					</button>
				</div>
			</div>
		</div>
	{/if}
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
	input,
	select {
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
	input:disabled,
	select:disabled {
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
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 5px;
		margin-bottom: 10px;
	}

	.browser-v2__tabs button {
		min-height: 28px;
		padding: 0 6px;
		font-size: 15px;
		line-height: 1;
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

	.browser-v2__field input,
	.browser-v2__field select {
		appearance: none;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		border: 1px solid rgba(91, 255, 187, 0.48);
		border-radius: 4px;
		background:
			linear-gradient(180deg, rgba(9, 38, 31, 0.96), rgba(1, 9, 8, 0.94)),
			rgba(1, 9, 8, 0.94);
		color: #f1fff6;
		padding: 7px 9px;
		font-size: 12px;
		outline: none;
		color-scheme: dark;
	}

	.browser-v2__field select {
		padding-right: 26px;
		background:
			linear-gradient(45deg, transparent 50%, #75ffd1 50%) right 12px top 12px /
				5px 5px no-repeat,
			linear-gradient(135deg, #75ffd1 50%, transparent 50%) right 7px top 12px /
				5px 5px no-repeat,
			linear-gradient(180deg, rgba(9, 38, 31, 0.96), rgba(1, 9, 8, 0.94)),
			rgba(1, 9, 8, 0.94);
	}

	.browser-v2__field select option {
		background: #06130f;
		color: #f1fff6;
	}

	.browser-v2__field input:focus,
	.browser-v2__field select:focus {
		border-color: #ffd666;
		box-shadow: 0 0 0 2px rgba(255, 214, 102, 0.16);
	}

	.browser-v2__toggles,
	.browser-v2__actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}

	.browser-v2__actions--single {
		grid-template-columns: 1fr;
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

	.browser-v2__modal-backdrop {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(0, 0, 0, 0.46);
		pointer-events: auto;
	}

	.browser-v2__diagnostics-modal {
		display: grid;
		grid-template-rows: auto minmax(240px, 1fr) auto;
		gap: 10px;
		width: min(920px, calc(100vw - 32px));
		height: min(680px, calc(100vh - 32px));
		box-sizing: border-box;
		padding: 12px;
		border: 1px solid rgba(91, 255, 187, 0.52);
		border-radius: 6px;
		background:
			linear-gradient(180deg, rgba(9, 27, 23, 0.98), rgba(4, 12, 11, 0.97)),
			rgba(4, 12, 11, 0.97);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.8),
			0 24px 70px rgba(0, 0, 0, 0.58),
			0 0 42px rgba(57, 255, 170, 0.13);
		color: #d9ffe8;
	}

	.browser-v2__diagnostics-header,
	.browser-v2__diagnostics-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
	}

	.browser-v2__diagnostics-header p {
		margin: 0 0 2px;
		color: #75ffd1;
		font-size: 10px;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.browser-v2__diagnostics-header h2 {
		margin: 0;
		color: #f1fff6;
		font-size: 16px;
		line-height: 1.2;
		letter-spacing: 0;
	}

	.browser-v2__diagnostics-modal textarea {
		width: 100%;
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
		resize: none;
		padding: 10px;
		border: 1px solid rgba(91, 255, 187, 0.25);
		border-radius: 4px;
		background: rgba(1, 9, 8, 0.88);
		color: #f1fff6;
		font:
			11px/1.45 "IBM Plex Mono",
			"SFMono-Regular",
			Consolas,
			"Liberation Mono",
			monospace;
		outline: none;
		white-space: pre;
	}

	.browser-v2__diagnostics-actions span {
		min-width: 0;
		color: #fff7cf;
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

		.browser-v2__actions,
		.browser-v2__toggles {
			grid-template-columns: 1fr;
		}

		.browser-v2__status div {
			grid-template-columns: 1fr;
		}

		.browser-v2__modal-backdrop {
			padding: 10px;
		}

		.browser-v2__diagnostics-modal {
			width: calc(100vw - 20px);
			height: calc(100vh - 20px);
		}
	}
</style>
