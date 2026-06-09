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
	import { browserJsProfiler } from "../lib/diagnostics/browser-js-profiler";
	import { formatHex32, normalizeOutdoorLandblockId } from "../lib/landblocks";
	import { countOutdoorSceneLodTiles } from "../lib/world-display/outdoor-scene-interest";
	import {
		formatRenderResourceInspectionKeyForDisplay,
		type RenderResourceInspectionSnapshot,
		type RenderResourceTexturePageIdentity,
	} from "../lib/world-display/render-resource-inspection";

	type BrowserPanelTabId =
		| "navigate"
		| "lod"
		| "scene"
		| "resources"
		| "picker"
		| "debug";
	type BrowserPanelTabIconId =
		| "navigate"
		| "settings"
		| "scene"
		| "picker"
		| "resources"
		| "debug";
	type ResourceSortDirection = "asc" | "desc";
	type BrowserPickerFamily =
		| "static"
		| "structured"
		| "terrain"
		| "portal"
		| "debug";

	interface BrowserPanelRow {
		label: string;
		value: string;
	}

	interface BrowserPanelSection {
		title: string;
		rows: BrowserPanelRow[];
	}

	interface BrowserPickerOptions {
		pickableFamilies: Record<BrowserPickerFamily, boolean>;
	}

	interface BrowserPickerReport {
		statusText: string;
		sections: BrowserPanelSection[];
	}

	interface FocusedCellReference {
		landblockId: number | null;
		cellId: number | null;
	}

	const browserPanelTabs = [
		{ id: "navigate", icon: "navigate", label: "Navigate" },
		{ id: "lod", icon: "settings", label: "Settings" },
		{ id: "scene", icon: "scene", label: "Scene" },
		{ id: "picker", icon: "picker", label: "Picker" },
		{ id: "resources", icon: "resources", label: "Resources" },
		{ id: "debug", icon: "debug", label: "Debug" },
	] satisfies readonly {
		id: BrowserPanelTabId;
		icon: BrowserPanelTabIconId;
		label: string;
	}[];
	const MAX_VISIBLE_RESOURCE_ROWS = 100;

	let {
		sceneStatusText,
		sceneSummaryRows,
		canResetCamera,
		onResetCamera,
		onGenerateDebugReport,
		pickerOptions,
		pickerReport,
		pickerArmed,
		resourceInspection,
		onGenerateResourceSnapshot,
		onPreviewTexturePage,
		onPickerOptionsChange,
		onTogglePickerMode,
	}: {
		sceneStatusText: string;
		sceneSummaryRows: BrowserPanelRow[];
		canResetCamera: boolean;
		onResetCamera: () => void;
		onGenerateDebugReport: () => void;
		pickerOptions: BrowserPickerOptions;
		pickerReport: BrowserPickerReport;
		pickerArmed: boolean;
		resourceInspection: RenderResourceInspectionSnapshot;
		onGenerateResourceSnapshot: () => void;
		onPreviewTexturePage: (identity: RenderResourceTexturePageIdentity) => void;
		onPickerOptionsChange: (options: BrowserPickerOptions) => void;
		onTogglePickerMode: () => void;
	} = $props();

	let activeTab = $state<BrowserPanelTabId>("navigate");
	let isCollapsed = $state(false);
	let isJsProfilerRunning = $state(browserJsProfiler.isEnabled());
	let texturePageFilter = $state("");
	let materialFilter = $state("");
	let textureSortDirection = $state<ResourceSortDirection>("desc");
	let materialSortDirection = $state<ResourceSortDirection>("desc");
	let geometryFilter = $state("");
	let staticBundleLayerFilter = $state("");
	let structuredInteriorCellFilter = $state("");
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
	const filteredTexturePages = $derived(
		filterResourcesByKey(resourceInspection.texturePages, texturePageFilter),
	);
	const sortedTexturePages = $derived(
		sortTextureResources(filteredTexturePages, textureSortDirection),
	);
	const visibleTexturePages = $derived(
		sortedTexturePages.slice(0, MAX_VISIBLE_RESOURCE_ROWS),
	);
	const filteredMaterials = $derived(
		filterResourcesByKey(resourceInspection.materials, materialFilter),
	);
	const sortedMaterials = $derived(
		sortMaterialResources(filteredMaterials, materialSortDirection),
	);
	const visibleMaterials = $derived(
		sortedMaterials.slice(0, MAX_VISIBLE_RESOURCE_ROWS),
	);
	const filteredGeometry = $derived(
		filterResourcesByKey(resourceInspection.geometry, geometryFilter),
	);
	const visibleGeometry = $derived(
		filteredGeometry.slice(0, MAX_VISIBLE_RESOURCE_ROWS),
	);
	const filteredStaticBundleLayers = $derived(
		filterResourcesByKey(
			resourceInspection.staticBundleLayers,
			staticBundleLayerFilter,
		),
	);
	const visibleStaticBundleLayers = $derived(
		filteredStaticBundleLayers.slice(0, MAX_VISIBLE_RESOURCE_ROWS),
	);
	const filteredStructuredInteriorCells = $derived(
		filterResourcesByKey(
			resourceInspection.structuredInteriorCells,
			structuredInteriorCellFilter,
		),
	);
	const visibleStructuredInteriorCells = $derived(
		filteredStructuredInteriorCells.slice(0, MAX_VISIBLE_RESOURCE_ROWS),
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

	function toggleJsProfiler(): void {
		if (isJsProfilerRunning) {
			browserJsProfiler.disable();
			isJsProfilerRunning = false;
			return;
		}

		browserJsProfiler.reset();
		browserJsProfiler.enable();
		isJsProfilerRunning = true;
	}

	function handlePickerFamilyToggle(
		family: BrowserPickerFamily,
		event: Event,
	): void {
		const input = event.currentTarget as HTMLInputElement;
		onPickerOptionsChange({
			...pickerOptions,
			pickableFamilies: {
				...pickerOptions.pickableFamilies,
				[family]: input.checked,
			},
		});
	}

	function formatOptionalHex32(value: number | null): string {
		return value === null ? "unavailable" : `0x${formatHex32(value)}`;
	}

	function formatResourceCount(value: number, singular: string): string {
		return `${value} ${formatCountedNoun(value, singular)}`;
	}

	function formatResourceRatio(numerator: number, denominator: number): string {
		return `${numerator}/${denominator}`;
	}

	function formatResourcePercent(value: number): string {
		return `${(value * 100).toFixed(1)}%`;
	}

	function formatCountedNoun(value: number, singular: string): string {
		if (value === 1) {
			return singular;
		}
		if (singular.endsWith("y")) {
			return `${singular.slice(0, -1)}ies`;
		}
		return `${singular}s`;
	}

	function formatVisibleResourceCount(
		visibleCount: number,
		matchedCount: number,
		totalCount: number,
	): string {
		if (matchedCount === totalCount) {
			return visibleCount === totalCount
				? `${totalCount}`
				: `${visibleCount}/${totalCount}`;
		}

		return visibleCount === matchedCount
			? `${matchedCount}/${totalCount}`
			: `${visibleCount}/${matchedCount}/${totalCount}`;
	}

	function formatResourceSnapshotTime(generatedAtMs: number): string {
		if (generatedAtMs <= 0) {
			return "No snapshot generated.";
		}
		return new Date(generatedAtMs).toLocaleTimeString();
	}

	function truncateResourceKey(value: string): string {
		const displayValue = formatRenderResourceInspectionKeyForDisplay(value);
		const maxLength = 72;
		return displayValue.length <= maxLength
			? displayValue
			: `${displayValue.slice(0, maxLength - 1)}…`;
	}

	function filterResourcesByKey<T extends { key: string }>(
		resources: readonly T[],
		filterText: string,
	): T[] {
		const needle = filterText.trim().toLowerCase();
		if (needle.length === 0) {
			return [...resources];
		}

		return resources.filter((resource) => {
			const displayKey = formatRenderResourceInspectionKeyForDisplay(
				resource.key,
			).toLowerCase();
			return resource.key.toLowerCase().includes(needle) ||
				displayKey.includes(needle);
		});
	}

	function sortTextureResources(
		resources: readonly RenderResourceInspectionSnapshot["texturePages"][number][],
		direction: ResourceSortDirection,
	): RenderResourceInspectionSnapshot["texturePages"][number][] {
		return [...resources].sort((left, right) =>
			applySortDirection(
				compareNumbers(left.width * left.height, right.width * right.height) ||
					compareNumbers(left.entryCount, right.entryCount) ||
					left.key.localeCompare(right.key),
				direction,
			),
		);
	}

	function sortMaterialResources(
		resources: readonly RenderResourceInspectionSnapshot["materials"][number][],
		direction: ResourceSortDirection,
	): RenderResourceInspectionSnapshot["materials"][number][] {
		return [...resources].sort((left, right) =>
			applySortDirection(
				compareNumbers(
					left.geometryReferenceCount,
					right.geometryReferenceCount,
				) ||
					compareNumbers(
						left.referencedTriangleCount,
						right.referencedTriangleCount,
					) ||
					compareNumbers(left.referencedIndexCount, right.referencedIndexCount) ||
					left.key.localeCompare(right.key),
				direction,
			),
		);
	}

	function compareNumbers(left: number, right: number): number {
		return right - left;
	}

	function applySortDirection(
		descendingComparison: number,
		direction: ResourceSortDirection,
	): number {
		return direction === "desc" ? descendingComparison : -descendingComparison;
	}

	function toggleTextureSortDirection(): void {
		textureSortDirection = invertSortDirection(textureSortDirection);
	}

	function toggleMaterialSortDirection(): void {
		materialSortDirection = invertSortDirection(materialSortDirection);
	}

	function invertSortDirection(
		direction: ResourceSortDirection,
	): ResourceSortDirection {
		return direction === "desc" ? "asc" : "desc";
	}

	function previewTexturePage(
		page: RenderResourceInspectionSnapshot["texturePages"][number],
	): void {
		onPreviewTexturePage({
			ownerKind: page.ownerKind,
			ownerKey: page.ownerKey,
			texturePageKey: page.key,
		});
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
				{#each browserPanelTabs as tab}
					<button
						type="button"
						class:active={activeTab === tab.id}
						role="tab"
						aria-label={tab.label}
						aria-selected={activeTab === tab.id}
						title={tab.label}
						onclick={() => selectTab(tab.id)}
					>
						<span class="browser-panel__tab-icon" aria-hidden="true">
							{#if tab.icon === "navigate"}
								<svg viewBox="0 0 24 24">
									<path d="M12 3L19 21L12 17L5 21L12 3Z" />
								</svg>
							{:else if tab.icon === "settings"}
								<svg viewBox="0 0 24 24">
									<path d="M4 7H14" />
									<path d="M18 7H20" />
									<path d="M4 17H6" />
									<path d="M10 17H20" />
									<circle cx="16" cy="7" r="2" />
									<circle cx="8" cy="17" r="2" />
								</svg>
							{:else if tab.icon === "scene"}
								<svg viewBox="0 0 24 24">
									<path d="M12 3L21 8L12 13L3 8L12 3Z" />
									<path d="M21 12L12 17L3 12" />
									<path d="M21 16L12 21L3 16" />
								</svg>
							{:else if tab.icon === "picker"}
								<svg viewBox="0 0 24 24">
									<circle cx="12" cy="12" r="5" />
									<path d="M12 3V7" />
									<path d="M12 17V21" />
									<path d="M3 12H7" />
									<path d="M17 12H21" />
								</svg>
							{:else if tab.icon === "resources"}
								<svg viewBox="0 0 24 24">
									<ellipse cx="12" cy="6" rx="7" ry="3" />
									<path d="M5 6V12C5 13.7 8.1 15 12 15C15.9 15 19 13.7 19 12V6" />
									<path d="M5 12V18C5 19.7 8.1 21 12 21C15.9 21 19 19.7 19 18V12" />
								</svg>
							{:else}
								<svg viewBox="0 0 24 24">
									<path d="M8 8H16V18H8V8Z" />
									<path d="M9 4L11 8" />
									<path d="M15 4L13 8" />
									<path d="M4 12H8" />
									<path d="M16 12H20" />
									<path d="M4 16H8" />
									<path d="M16 16H20" />
								</svg>
							{/if}
						</span>
					</button>
				{/each}
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
	{:else if !isCollapsed && activeTab === "resources"}
		<div class="browser-panel__body" role="tabpanel">
			<p class="browser-panel__status">
				{resourceInspection.generatedAtMs > 0
					? `Snapshot generated at ${formatResourceSnapshotTime(resourceInspection.generatedAtMs)}.`
					: "Generate a point-in-time view of resident renderer resources from the WebGL2 resource stores."}
			</p>
			<div class="browser-panel__debug-actions">
				<button type="button" onclick={onGenerateResourceSnapshot}>
					Generate Snapshot
				</button>
			</div>
			<dl class="data-list compact-data-list browser-panel__summary-list">
				<div>
					<dt>Snapshot</dt>
					<dd>{formatResourceSnapshotTime(resourceInspection.generatedAtMs)}</dd>
				</div>
				<div>
					<dt>Layers</dt>
					<dd>
						{formatResourceCount(
							resourceInspection.summary.staticBundleLayerCount,
							"static bundle",
						)}
					</dd>
				</div>
				<div>
					<dt>Cells</dt>
					<dd>
						{formatResourceCount(
							resourceInspection.summary.structuredInteriorCellCount,
							"structured cell",
						)}
					</dd>
				</div>
				<div>
					<dt>Textures</dt>
					<dd>
						{formatResourceCount(
							resourceInspection.summary.texturePageCount,
							"texture",
						)}
						({formatResourceCount(
							resourceInspection.summary.texturePageEntryCount,
							"entry",
						)})
					</dd>
				</div>
				<div>
					<dt>Materials</dt>
					<dd>
						{formatResourceCount(
							resourceInspection.summary.materialCount,
							"record",
						)}
					</dd>
				</div>
				<div>
					<dt>Geometry</dt>
					<dd>
						{formatResourceCount(
							resourceInspection.summary.geometryResourceCount,
							"resource",
						)}
						({resourceInspection.summary.triangleCount} tris)
					</dd>
				</div>
			</dl>

			<details class="browser-panel__details" open>
				<summary>Textures</summary>
				<div class="browser-panel__resource-controls">
					<label class="browser-panel__resource-filter">
						<span>
							Filter ID ({formatVisibleResourceCount(
								visibleTexturePages.length,
								filteredTexturePages.length,
								resourceInspection.texturePages.length,
							)})
						</span>
						<input
							type="search"
							bind:value={texturePageFilter}
							placeholder="texture id substring"
							spellcheck="false"
						/>
					</label>
					<button
						type="button"
						class="browser-panel__resource-sort"
						aria-label={`Sort textures ${textureSortDirection === "desc" ? "ascending" : "descending"}`}
						title={`Sort by size and entries ${textureSortDirection === "desc" ? "ascending" : "descending"}`}
						onclick={toggleTextureSortDirection}
					>
						<span aria-hidden="true">
							{#if textureSortDirection === "desc"}
								<svg viewBox="0 0 24 24">
									<path d="M12 5V19" />
									<path d="M6 13L12 19L18 13" />
								</svg>
							{:else}
								<svg viewBox="0 0 24 24">
									<path d="M12 19V5" />
									<path d="M6 11L12 5L18 11" />
								</svg>
							{/if}
						</span>
					</button>
				</div>
				{#if filteredTexturePages.length > visibleTexturePages.length}
					<p class="browser-panel__resource-limit">
						Showing first {MAX_VISIBLE_RESOURCE_ROWS} matches. Narrow the filter
						to inspect more specific rows.
					</p>
				{/if}
				<div class="browser-panel__resource-scroll">
					<dl class="data-list compact-data-list browser-panel__resource-list">
						{#each visibleTexturePages as page}
							<div>
								<dt title={page.key}>
									<button
										type="button"
										class="browser-panel__resource-link"
										onclick={() => previewTexturePage(page)}
									>
										{truncateResourceKey(page.key)}
									</button>
								</dt>
								<dd>
									{page.ownerKind}; owner {truncateResourceKey(page.ownerKey)};
									{page.bucket}; {page.sampleClass};
									{page.width}x{page.height}; {formatResourceCount(
										page.entryCount,
										"entry",
									)}; aliases {page.virtualAliasCount}; coverage {formatResourcePercent(
										page.coverageRatio,
									)}
								</dd>
							</div>
						{:else}
							<div>
								<dt>Textures</dt>
								<dd>No matching resident textures.</dd>
							</div>
						{/each}
					</dl>
				</div>
			</details>

			<details class="browser-panel__details" open>
				<summary>Materials</summary>
				<div class="browser-panel__resource-controls">
					<label class="browser-panel__resource-filter">
						<span>
							Filter ID ({formatVisibleResourceCount(
								visibleMaterials.length,
								filteredMaterials.length,
								resourceInspection.materials.length,
							)})
						</span>
						<input
							type="search"
							bind:value={materialFilter}
							placeholder="material id substring"
							spellcheck="false"
						/>
					</label>
					<button
						type="button"
						class="browser-panel__resource-sort"
						aria-label={`Sort materials ${materialSortDirection === "desc" ? "ascending" : "descending"}`}
						title={`Sort by usage ${materialSortDirection === "desc" ? "ascending" : "descending"}`}
						onclick={toggleMaterialSortDirection}
					>
						<span aria-hidden="true">
							{#if materialSortDirection === "desc"}
								<svg viewBox="0 0 24 24">
									<path d="M12 5V19" />
									<path d="M6 13L12 19L18 13" />
								</svg>
							{:else}
								<svg viewBox="0 0 24 24">
									<path d="M12 19V5" />
									<path d="M6 11L12 5L18 11" />
								</svg>
							{/if}
						</span>
					</button>
				</div>
				{#if filteredMaterials.length > visibleMaterials.length}
					<p class="browser-panel__resource-limit">
						Showing first {MAX_VISIBLE_RESOURCE_ROWS} matches. Narrow the filter
						to inspect more specific rows.
					</p>
				{/if}
				<div class="browser-panel__resource-scroll">
					<dl class="data-list compact-data-list browser-panel__resource-list">
						{#each visibleMaterials as material}
							<div>
								<dt title={material.key}>{truncateResourceKey(material.key)}</dt>
								<dd>
									{material.ownerKind}; owner {truncateResourceKey(
										material.ownerKey,
									)}; {material.familyKey};
									{material.alphaPolicy ?? "alpha n/a"}; bindings {material.textureBindingCount};
									refs {material.geometryReferenceCount}; indices {material.referencedIndexCount};
									tris {material.referencedTriangleCount};
									{material.indexed ? "indexed" : "direct"};
									detail {material.detailTextureRefKey
										? material.detailTiling
										: "none"}
								</dd>
							</div>
						{:else}
							<div>
								<dt>Materials</dt>
								<dd>No matching resident material records.</dd>
							</div>
						{/each}
					</dl>
				</div>
			</details>

			<details class="browser-panel__details">
				<summary>Geometry</summary>
				<label class="browser-panel__resource-filter">
					<span>
						Filter ID ({formatVisibleResourceCount(
							visibleGeometry.length,
							filteredGeometry.length,
							resourceInspection.geometry.length,
						)})
					</span>
					<input
						type="search"
						bind:value={geometryFilter}
						placeholder="geometry id substring"
						spellcheck="false"
					/>
				</label>
				{#if filteredGeometry.length > visibleGeometry.length}
					<p class="browser-panel__resource-limit">
						Showing first {MAX_VISIBLE_RESOURCE_ROWS} matches. Narrow the filter
						to inspect more specific rows.
					</p>
				{/if}
				<div class="browser-panel__resource-scroll">
					<dl class="data-list compact-data-list browser-panel__resource-list">
						{#each visibleGeometry as geometry}
							<div>
								<dt title={geometry.key}>{truncateResourceKey(geometry.key)}</dt>
								<dd>
									{geometry.ownerKind}; owner {truncateResourceKey(
										geometry.ownerKey,
									)}; {geometry.geometryKind};
									{geometry.triangleCount} tris; indices {geometry.indexCount};
									material {geometry.materialRecordKey
										? truncateResourceKey(geometry.materialRecordKey)
										: "none"}
								</dd>
							</div>
						{:else}
							<div>
								<dt>Geometry</dt>
								<dd>No matching resident geometry resources.</dd>
							</div>
						{/each}
					</dl>
				</div>
			</details>

			<details class="browser-panel__details">
				<summary>Static Bundle Layers</summary>
				<label class="browser-panel__resource-filter">
					<span>
						Filter ID ({formatVisibleResourceCount(
							visibleStaticBundleLayers.length,
							filteredStaticBundleLayers.length,
							resourceInspection.staticBundleLayers.length,
						)})
					</span>
					<input
						type="search"
						bind:value={staticBundleLayerFilter}
						placeholder="static bundle id substring"
						spellcheck="false"
					/>
				</label>
				{#if filteredStaticBundleLayers.length > visibleStaticBundleLayers.length}
					<p class="browser-panel__resource-limit">
						Showing first {MAX_VISIBLE_RESOURCE_ROWS} matches. Narrow the filter
						to inspect more specific rows.
					</p>
				{/if}
				<div class="browser-panel__resource-scroll">
					<dl class="data-list compact-data-list browser-panel__resource-list">
						{#each visibleStaticBundleLayers as layer}
							<div>
								<dt title={layer.key}>{truncateResourceKey(layer.key)}</dt>
								<dd>
									0x{formatHex32(layer.landblockId)} {layer.bundleKind};
									objects {formatResourceRatio(
										layer.objectRecordCount,
										layer.sourceObjectCount,
									)};
									materials {layer.materialCount}; pages {layer.texturePageCount};
									{layer.triangleCount} tris
								</dd>
							</div>
						{:else}
							<div>
								<dt>Layers</dt>
								<dd>No matching resident static bundle layers.</dd>
							</div>
						{/each}
					</dl>
				</div>
			</details>

			<details class="browser-panel__details">
				<summary>Structured Interior Cells</summary>
				<label class="browser-panel__resource-filter">
					<span>
						Filter ID ({formatVisibleResourceCount(
							visibleStructuredInteriorCells.length,
							filteredStructuredInteriorCells.length,
							resourceInspection.structuredInteriorCells.length,
						)})
					</span>
					<input
						type="search"
						bind:value={structuredInteriorCellFilter}
						placeholder="structured cell id substring"
						spellcheck="false"
					/>
				</label>
				{#if filteredStructuredInteriorCells.length > visibleStructuredInteriorCells.length}
					<p class="browser-panel__resource-limit">
						Showing first {MAX_VISIBLE_RESOURCE_ROWS} matches. Narrow the filter
						to inspect more specific rows.
					</p>
				{/if}
				<div class="browser-panel__resource-scroll">
					<dl class="data-list compact-data-list browser-panel__resource-list">
						{#each visibleStructuredInteriorCells as cell}
							<div>
								<dt title={cell.key}>{truncateResourceKey(cell.key)}</dt>
								<dd>
									cell 0x{formatHex32(cell.envCellId)}; slices
									{cell.materialSliceCount}; materials {cell.materialCount}; pages
									{cell.texturePageCount}; {cell.triangleCount} tris;
									{cell.hasFallbackShell ? "fallback shell" : "material slices"}
								</dd>
							</div>
						{:else}
							<div>
								<dt>Cells</dt>
								<dd>No matching resident structured interior cells.</dd>
							</div>
						{/each}
					</dl>
				</div>
			</details>
		</div>
	{:else if !isCollapsed && activeTab === "picker"}
		<div class="browser-panel__body" role="tabpanel">
			<p class="browser-panel__status">{pickerReport.statusText}</p>

			<fieldset class="browser-form__fieldset">
				<legend>Pickable renderables</legend>
				<label class="browser-form__field browser-form__field--checkbox">
					<span><strong>Static objects</strong></span>
					<input
						type="checkbox"
						checked={pickerOptions.pickableFamilies.static}
						onchange={(event) => handlePickerFamilyToggle("static", event)}
					/>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span><strong>Structured interiors</strong></span>
					<input
						type="checkbox"
						checked={pickerOptions.pickableFamilies.structured}
						onchange={(event) => handlePickerFamilyToggle("structured", event)}
					/>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span><strong>Terrain</strong></span>
					<input
						type="checkbox"
						checked={pickerOptions.pickableFamilies.terrain}
						onchange={(event) => handlePickerFamilyToggle("terrain", event)}
					/>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span><strong>Portals</strong></span>
					<input
						type="checkbox"
						checked={pickerOptions.pickableFamilies.portal}
						onchange={(event) => handlePickerFamilyToggle("portal", event)}
					/>
				</label>
				<label class="browser-form__field browser-form__field--checkbox">
					<span><strong>Debug overlays</strong></span>
					<input
						type="checkbox"
						checked={pickerOptions.pickableFamilies.debug}
						onchange={(event) => handlePickerFamilyToggle("debug", event)}
					/>
				</label>
			</fieldset>

			<div class="browser-panel__debug-actions">
				<button
					type="button"
					aria-pressed={pickerArmed}
					onclick={onTogglePickerMode}
				>
					{pickerArmed ? "Cancel pick" : "Pick from scene"}
				</button>
			</div>

			{#each pickerReport.sections as section}
				<details class="browser-panel__details" open>
					<summary>{section.title}</summary>
					<dl class="data-list compact-data-list">
						{#each section.rows as row}
							<div>
								<dt>{row.label}</dt>
								<dd>{row.value}</dd>
							</div>
						{/each}
					</dl>
				</details>
			{/each}
		</div>
	{:else if !isCollapsed}
		<div class="browser-panel__body" role="tabpanel">
			<div class="browser-panel__debug-report">
				<p class="browser-panel__status">
					Generate a one-frame diagnostics report with the detailed renderer,
					asset, camera, and scene state.
				</p>
				<div class="browser-panel__debug-actions">
					<button type="button" onclick={onGenerateDebugReport}>
						Generate Report
					</button>
					<button
						type="button"
						aria-pressed={isJsProfilerRunning}
						onclick={toggleJsProfiler}
					>
						{isJsProfilerRunning ? "Flush Profiler" : "Start Profiler"}
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>
