<script lang="ts">
	import { frontendState } from "../app/frontend-state";
	import {
		browserLocationToLandblockId,
		isLandblockPrefixInput,
		MAX_BROWSER_CAMERA_FAR_PLANE,
		MAX_BROWSER_CAMERA_NEAR_PLANE,
		MAX_BROWSER_LOD_RADIUS,
		MAX_TRANSITION_PORTAL_MAX_DEPTH,
		MIN_BROWSER_CAMERA_FAR_PLANE,
		MIN_BROWSER_CAMERA_NEAR_PLANE,
		MIN_BROWSER_LOD_RADIUS,
		MIN_TRANSITION_PORTAL_MAX_DEPTH,
		type BrowserRenderStyle,
		type BrowserNavigationFocusMode,
		type BrowserTextureFilteringMode,
	} from "../app/browser-mode";
	import { formatHex32, normalizeOutdoorLandblockId } from "../lib/landblocks";
	import { countOutdoorSceneLodTiles } from "../lib/world-display/outdoor-scene-interest";

	type BrowserPanelTabId = "navigate" | "lod" | "scene" | "debug";

	interface BrowserPanelRow {
		label: string;
		value: string;
	}

	interface BrowserPanelSection {
		title: string;
		rows: BrowserPanelRow[];
	}

	interface FocusedCellReference {
		landblockId: number | null;
		cellId: number | null;
	}

	let {
		sceneStatusText,
		sceneSummaryRows,
		canResetCamera,
		onResetCamera,
		onGenerateDebugReport,
	}: {
		sceneStatusText: string;
		sceneSummaryRows: BrowserPanelRow[];
		canResetCamera: boolean;
		onResetCamera: () => void;
		onGenerateDebugReport: () => void;
	} = $props();

	let activeTab = $state<BrowserPanelTabId>("navigate");
	let isCollapsed = $state(false);
	const focusedCellReference = $derived.by<FocusedCellReference>(() => {
		const destination = $frontendState.browserMode.destination;
		if (destination?.kind === "interior-cell") {
			return {
				landblockId: normalizeOutdoorLandblockId(destination.landblockId),
				cellId: destination.envCellId,
			};
		}

		if (destination?.kind === "outdoor-location") {
			return {
				landblockId: normalizeOutdoorLandblockId(
					browserLocationToLandblockId(destination),
				),
				cellId: null,
			};
		}

		return { landblockId: null, cellId: null };
	});
	const draftIsLandblockPrefix = $derived(
		isLandblockPrefixInput($frontendState.browserMode.draftInput),
	);

	function selectTab(tabId: BrowserPanelTabId): void {
		activeTab = tabId;
	}

	function toggleCollapsed(): void {
		isCollapsed = !isCollapsed;
	}

	function handleDraftInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateBrowserDraft(input.value);
	}

	function setNavigationFocusMode(
		navigationFocusMode: BrowserNavigationFocusMode,
	): void {
		frontendState.updateNavigationFocusMode(navigationFocusMode);
	}

	function toggleLandblockInputMode(): void {
		if (!draftIsLandblockPrefix) {
			return;
		}

		frontendState.updateLandblockInputMode(
			$frontendState.browserMode.landblockInputMode === "dungeon"
				? "outdoor"
				: "dungeon",
		);
	}

	function previewDestination(event?: SubmitEvent): void {
		event?.preventDefault();
		frontendState.previewBrowserLocation();
	}

	function handleTerrainLodInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateTerrainLodRadius(Number(input.value));
	}

	function handleBuildingLodInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateBuildingLodRadius(Number(input.value));
	}

	function handleDetailLodInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateDetailLodRadius(Number(input.value));
	}

	function handleEnvCellLodInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateEnvCellLodRadius(Number(input.value));
	}

	function handleTransitionPortalMaxDepthInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateTransitionPortalMaxDepth(Number(input.value));
	}

	function handleCameraNearPlaneInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateBrowserCameraNearPlane(Number(input.value));
	}

	function handleCameraFarPlaneInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateBrowserCameraFarPlane(Number(input.value));
	}

	function handlePortalPolygonsToggle(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updatePortalPolygonVisibility(input.checked);
	}

	function handleCellIndicatorsToggle(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateCellIndicatorVisibility(input.checked);
	}

	function handlePortalTargetHighlightToggle(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updatePortalTargetHighlighting(input.checked);
	}

	function handleRenderStyleChange(renderStyle: BrowserRenderStyle): void {
		frontendState.updateBrowserRenderStyle(renderStyle);
	}

	function handleTextureFilteringModeChange(event: Event): void {
		const select = event.currentTarget as HTMLSelectElement;
		frontendState.updateBrowserTextureFilteringMode(
			select.value as BrowserTextureFilteringMode,
		);
	}

	function handleDetailTexturesToggle(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateBrowserDetailTexturesEnabled(input.checked);
	}

	function formatOptionalHex32(value: number | null): string {
		return value === null ? "unavailable" : `0x${formatHex32(value)}`;
	}
</script>

<section class:collapsed={isCollapsed} class="browser-panel" data-browser-panel>
	<div class="browser-panel__bar">
		{#if !isCollapsed}
			<div
				class="browser-panel__tabs"
				role="tablist"
				aria-label="Browser panel"
			>
				<button
					type="button"
					class:active={activeTab === "navigate"}
					role="tab"
					aria-selected={activeTab === "navigate"}
					onclick={() => selectTab("navigate")}
				>
					Navigate
				</button>
				<button
					type="button"
					class:active={activeTab === "lod"}
					role="tab"
					aria-selected={activeTab === "lod"}
					onclick={() => selectTab("lod")}
				>
					Settings
				</button>
				<button
					type="button"
					class:active={activeTab === "scene"}
					role="tab"
					aria-selected={activeTab === "scene"}
					onclick={() => selectTab("scene")}
				>
					Scene
				</button>
				<button
					type="button"
					class:active={activeTab === "debug"}
					role="tab"
					aria-selected={activeTab === "debug"}
					onclick={() => selectTab("debug")}
				>
					Debug
				</button>
			</div>
		{/if}

		<button
			type="button"
			class="browser-panel__collapse"
			aria-label={isCollapsed
				? "Expand browser panel"
				: "Collapse browser panel"}
			aria-expanded={!isCollapsed}
			onclick={toggleCollapsed}
		>
			{isCollapsed ? "+" : "-"}
		</button>
	</div>

	{#if !isCollapsed && activeTab === "navigate"}
		<div class="browser-panel__body" role="tabpanel">
			<dl class="data-list compact-data-list">
				<div>
					<dt>Navigation</dt>
					<dd>
						{$frontendState.browserMode.navigationFocusMode === "follow-camera"
							? "Follow camera"
							: "Manual"}
					</dd>
				</div>
				<div>
					<dt>Anchor</dt>
					<dd>
						{$frontendState.browserMode.destination?.label ?? "unavailable"}
					</dd>
				</div>
				<div>
					<dt>Landblock ID</dt>
					<dd>{formatOptionalHex32(focusedCellReference.landblockId)}</dd>
				</div>
				<div>
					<dt>Cell ID</dt>
					<dd>{formatOptionalHex32(focusedCellReference.cellId)}</dd>
				</div>
			</dl>

			<div
				class="browser-form__segmented"
				role="group"
				aria-label="Navigation focus mode"
			>
				<button
					type="button"
					class:active={$frontendState.browserMode.navigationFocusMode ===
						"manual"}
					aria-pressed={$frontendState.browserMode.navigationFocusMode ===
						"manual"}
					onclick={() => setNavigationFocusMode("manual")}
				>
					Manual
				</button>
				<button
					type="button"
					class:active={$frontendState.browserMode.navigationFocusMode ===
						"follow-camera"}
					aria-pressed={$frontendState.browserMode.navigationFocusMode ===
						"follow-camera"}
					onclick={() => setNavigationFocusMode("follow-camera")}
				>
					Follow camera
				</button>
			</div>

			<form class="browser-form" onsubmit={previewDestination}>
				<label class="browser-form__field" for="browser-location-input">
					<span>Location</span>
					<input
						id="browser-location-input"
						type="text"
						value={$frontendState.browserMode.draftInput}
						oninput={handleDraftInput}
						placeholder="33.50S, 72.80E, 0xda55, or 0x016c0155"
						spellcheck="false"
					/>
				</label>

				<div
					class:disabled={!draftIsLandblockPrefix}
					class="browser-form__switch-row"
				>
					<span>Landblock focus</span>
					<button
						type="button"
						class:active={$frontendState.browserMode.landblockInputMode ===
							"dungeon"}
						class="browser-form__mode-switch"
						disabled={!draftIsLandblockPrefix}
						aria-pressed={$frontendState.browserMode.landblockInputMode ===
							"dungeon"}
						aria-label={`Landblock focus: ${$frontendState.browserMode.landblockInputMode === "dungeon" ? "Dungeon" : "Outdoor"}`}
						onclick={toggleLandblockInputMode}
					>
						<span class="browser-form__mode-switch-track">
							<span class="browser-form__mode-switch-thumb"></span>
						</span>
						<span class="browser-form__mode-switch-label">
							{$frontendState.browserMode.landblockInputMode === "dungeon"
								? "Dungeon"
								: "Outdoor"}
						</span>
					</button>
				</div>

				<div class="browser-form__actions">
					<button type="submit">Set destination</button>
					<button
						type="button"
						onclick={onResetCamera}
						disabled={!canResetCamera}
					>
						Reset camera
					</button>
				</div>
			</form>

			{#if $frontendState.browserMode.validationMessage}
				<p class="validation-message">
					{$frontendState.browserMode.validationMessage}
				</p>
			{/if}
		</div>
	{:else if !isCollapsed && activeTab === "lod"}
		<div class="browser-panel__body" role="tabpanel">
			<div class="browser-form__slider-row browser-form__slider-row--triple">
				<label
					class="browser-form__field browser-form__field--range"
					for="terrain-lod-input"
				>
					<span>Terrain distance</span>
					<strong>
						{$frontendState.browserMode.terrainLodRadius} out ({countOutdoorSceneLodTiles(
							$frontendState.browserMode.terrainLodRadius,
						)}
						tiles)
					</strong>
					<input
						id="terrain-lod-input"
						type="range"
						min={MIN_BROWSER_LOD_RADIUS}
						max={MAX_BROWSER_LOD_RADIUS}
						step="1"
						value={$frontendState.browserMode.terrainLodRadius}
						oninput={handleTerrainLodInput}
					/>
				</label>

				<label
					class="browser-form__field browser-form__field--range"
					for="building-lod-input"
				>
					<span>Building distance</span>
					<strong>
						{$frontendState.browserMode.buildingLodRadius} out ({countOutdoorSceneLodTiles(
							$frontendState.browserMode.buildingLodRadius,
						)}
						tiles)
					</strong>
					<input
						id="building-lod-input"
						type="range"
						min={MIN_BROWSER_LOD_RADIUS}
						max={$frontendState.browserMode.terrainLodRadius}
						step="1"
						value={$frontendState.browserMode.buildingLodRadius}
						oninput={handleBuildingLodInput}
					/>
				</label>

				<label
					class="browser-form__field browser-form__field--range"
					for="detail-lod-input"
				>
					<span>Detail distance</span>
					<strong>
						{$frontendState.browserMode.detailLodRadius} out ({countOutdoorSceneLodTiles(
							$frontendState.browserMode.detailLodRadius,
						)}
						tiles)
					</strong>
					<input
						id="detail-lod-input"
						type="range"
						min={MIN_BROWSER_LOD_RADIUS}
						max={$frontendState.browserMode.buildingLodRadius}
						step="1"
						value={$frontendState.browserMode.detailLodRadius}
						oninput={handleDetailLodInput}
					/>
				</label>
			</div>

			<div class="browser-form__slider-row browser-form__slider-row--single">
				<label
					class="browser-form__field browser-form__field--range"
					for="env-cell-lod-input"
				>
					<span>Env cell distance</span>
					<strong>
						{$frontendState.browserMode.envCellLodRadius} out ({countOutdoorSceneLodTiles(
							$frontendState.browserMode.envCellLodRadius,
						)}
						tiles)
					</strong>
					<input
						id="env-cell-lod-input"
						type="range"
						min={MIN_BROWSER_LOD_RADIUS}
						max={$frontendState.browserMode.terrainLodRadius}
						step="1"
						value={$frontendState.browserMode.envCellLodRadius}
						oninput={handleEnvCellLodInput}
					/>
				</label>
			</div>

			<fieldset class="browser-form__fieldset">
				<legend>Portal rendering</legend>
				<div class="browser-form__slider-row browser-form__slider-row--single">
					<label
						class="browser-form__field browser-form__field--range"
						for="transition-portal-depth-input"
					>
						<span>Transition depth</span>
						<strong>
							{$frontendState.browserMode.transitionPortalMaxDepth} level{$frontendState
								.browserMode.transitionPortalMaxDepth === 1
								? ""
								: "s"}
						</strong>
						<input
							id="transition-portal-depth-input"
							type="range"
							min={MIN_TRANSITION_PORTAL_MAX_DEPTH}
							max={MAX_TRANSITION_PORTAL_MAX_DEPTH}
							step="1"
							value={$frontendState.browserMode.transitionPortalMaxDepth}
							oninput={handleTransitionPortalMaxDepthInput}
						/>
					</label>
				</div>
			</fieldset>

			<fieldset class="browser-form__fieldset">
				<legend>Camera clipping</legend>
				<div class="browser-form__slider-row">
					<label
						class="browser-form__field browser-form__field--range"
						for="camera-near-plane-input"
					>
						<span>Near</span>
						<strong>
							{$frontendState.browserMode.cameraNearPlane.toFixed(1)}
						</strong>
						<input
							id="camera-near-plane-input"
							type="range"
							min={MIN_BROWSER_CAMERA_NEAR_PLANE}
							max={MAX_BROWSER_CAMERA_NEAR_PLANE}
							step="0.01"
							value={$frontendState.browserMode.cameraNearPlane}
							oninput={handleCameraNearPlaneInput}
						/>
					</label>
					<label
						class="browser-form__field browser-form__field--range"
						for="camera-far-plane-input"
					>
						<span>Far</span>
						<strong>
							{$frontendState.browserMode.cameraFarPlane.toFixed(0)}
						</strong>
						<input
							id="camera-far-plane-input"
							type="range"
							min={MIN_BROWSER_CAMERA_FAR_PLANE}
							max={MAX_BROWSER_CAMERA_FAR_PLANE}
							step="250"
							value={$frontendState.browserMode.cameraFarPlane}
							oninput={handleCameraFarPlaneInput}
						/>
					</label>
				</div>
			</fieldset>

			<fieldset class="browser-form__fieldset">
				<legend>Textures</legend>
				<label class="browser-form__field" for="texture-filtering-mode">
					<span>Filtering</span>
					<select
						id="texture-filtering-mode"
						value={$frontendState.browserMode.textureFilteringMode}
						onchange={handleTextureFilteringModeChange}
					>
						<option value="nearest">Nearest</option>
						<option value="linear">Linear</option>
						<option value="anisotropic-4x">Anisotropic 4x</option>
					</select>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span>
						<strong>Detail textures</strong>
						<small>Apply region detail overlays.</small>
					</span>
					<input
						type="checkbox"
						checked={$frontendState.browserMode.detailTexturesEnabled}
						onchange={handleDetailTexturesToggle}
					/>
				</label>
			</fieldset>

			<fieldset class="browser-form__fieldset">
				<legend>Diagnostics</legend>
				<label class="browser-form__field browser-form__field--checkbox">
					<span>
						<strong>Portal polygons</strong>
						<small>Show decoded portal opening outlines.</small>
					</span>
					<input
						type="checkbox"
						checked={$frontendState.browserMode.showPortalPolygons}
						onchange={handlePortalPolygonsToggle}
					/>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span>
						<strong>Cell indicators</strong>
						<small>Show env-cell bounds.</small>
					</span>
					<input
						type="checkbox"
						checked={$frontendState.browserMode.showCellIndicators}
						onchange={handleCellIndicatorsToggle}
					/>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span>
						<strong>Portal targets</strong>
						<small>Color portal outlines by target/load status.</small>
					</span>
					<input
						type="checkbox"
						checked={$frontendState.browserMode.highlightPortalTargets}
						onchange={handlePortalTargetHighlightToggle}
					/>
				</label>
			</fieldset>
		</div>
	{:else if !isCollapsed && activeTab === "scene"}
		<div class="browser-panel__body" role="tabpanel">
			<p class="browser-panel__status">{sceneStatusText}</p>
			<div
				class="browser-form__segmented"
				role="group"
				aria-label="Render style"
			>
				<button
					type="button"
					class:active={$frontendState.browserMode.renderStyle === "solid"}
					aria-pressed={$frontendState.browserMode.renderStyle === "solid"}
					onclick={() => handleRenderStyleChange("solid")}
				>
					Solid
				</button>
				<button
					type="button"
					class:active={$frontendState.browserMode.renderStyle === "wireframe"}
					aria-pressed={$frontendState.browserMode.renderStyle === "wireframe"}
					onclick={() => handleRenderStyleChange("wireframe")}
				>
					Wireframe
				</button>
				<button
					type="button"
					class:active={$frontendState.browserMode.renderStyle ===
						"no-material"}
					aria-pressed={$frontendState.browserMode.renderStyle ===
						"no-material"}
					onclick={() => handleRenderStyleChange("no-material")}
				>
					No material
				</button>
			</div>
			<dl class="data-list compact-data-list browser-panel__summary-list">
				{#each sceneSummaryRows as row}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
		</div>
	{:else if !isCollapsed}
		<div class="browser-panel__body" role="tabpanel">
			<div class="browser-panel__debug-report">
				<p class="browser-panel__status">
					Generate a one-frame diagnostics report with the detailed renderer,
					asset, camera, and scene state.
				</p>
				<button type="button" onclick={onGenerateDebugReport}>
					Generate Report
				</button>
			</div>
		</div>
	{/if}
</section>
