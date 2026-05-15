<script lang="ts">
	import { frontendState } from "../app/frontend-state";
	import {
		browserLocationToLandblockId,
		MAX_BROWSER_LOD_RADIUS,
		MAX_STRUCTURED_INTERIOR_MAX_ENV_CELLS,
		MAX_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH,
		MIN_BROWSER_LOD_RADIUS,
		MIN_STRUCTURED_INTERIOR_MAX_ENV_CELLS,
		MIN_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH,
	} from "../app/browser-mode";
	import { formatHex32, normalizeOutdoorLandblockId } from "../lib/landblocks";
	import { countOutdoorSceneLodTiles } from "../lib/world-display/outdoor-scene-interest";

	type BrowserPanelTabId = "navigate" | "lod" | "scene" | "debug";

	interface BrowserPanelRow {
		label: string;
		value: string;
	}

	interface FocusedCellReference {
		landblockId: number | null;
		cellId: number | null;
	}

	let {
		sceneStatusText,
		sceneRows,
		debugRows,
	}: {
		sceneStatusText: string;
		sceneRows: BrowserPanelRow[];
		debugRows: BrowserPanelRow[];
	} = $props();

	let activeTab = $state<BrowserPanelTabId>("navigate");
	let isCollapsed = $state(false);
	const focusedCellReference = $derived.by<FocusedCellReference>(() => {
		const destination = $frontendState.browserMode.destination;
		if (destination?.kind === "indoor-env-cell") {
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

		const residency =
			$frontendState.host.boundarySnapshot?.runtimeBatch.residency;
		if (!residency) {
			return { landblockId: null, cellId: null };
		}

		const landblockId = normalizeOutdoorLandblockId(residency.focusLandblockId);
		const cellId =
			residency.focusEnvCellId ??
			(residency.focusCellId === null
				? null
				: normalizeLandblockCellId(landblockId, residency.focusCellId));

		return { landblockId, cellId };
	});

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

	function previewDestination(event?: SubmitEvent): void {
		event?.preventDefault();
		frontendState.previewBrowserLocation();
	}

	function useCurrentRuntimeResidency(): void {
		frontendState.useRuntimeResidencyDestination();
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

	function handleStructuredInteriorMaxEnvCellsInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateStructuredInteriorMaxEnvCells(Number(input.value));
	}

	function handleStructuredInteriorMaxVisibleCellDepthInput(
		event: Event,
	): void {
		const input = event.currentTarget as HTMLInputElement;
		frontendState.updateStructuredInteriorMaxVisibleCellDepth(
			Number(input.value),
		);
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

	function normalizeLandblockCellId(
		landblockId: number,
		focusCellId: number,
	): number {
		return ((landblockId & 0xffff0000) | (focusCellId & 0xffff)) >>> 0;
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
					<dt>Anchor</dt>
					<dd>
						{$frontendState.browserMode.destination?.label ??
							$frontendState.host.boundarySnapshot?.runtimeBatch.residency
								.focusLocationLabel ??
							"unavailable"}
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

			<form class="browser-form" onsubmit={previewDestination}>
				<label class="browser-form__field" for="browser-location-input">
					<span>Location</span>
					<input
						id="browser-location-input"
						type="text"
						value={$frontendState.browserMode.draftInput}
						oninput={handleDraftInput}
						placeholder="33.50S, 72.80E, 0.0Z or 0x016c0155"
						spellcheck="false"
					/>
				</label>

				<div class="browser-form__actions">
					<button type="submit">Set destination</button>
					<button
						type="button"
						onclick={useCurrentRuntimeResidency}
						disabled={!$frontendState.host.boundarySnapshot}
					>
						Use current
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

			<fieldset class="browser-form__fieldset">
				<legend>Env cells</legend>
				<div class="browser-form__slider-row">
					<label
						class="browser-form__field browser-form__field--range"
						for="interior-max-cells-input"
					>
						<span>Max limit</span>
						<strong>
							{$frontendState.browserMode.structuredInteriorMaxEnvCells} cells
						</strong>
						<input
							id="interior-max-cells-input"
							type="range"
							min={MIN_STRUCTURED_INTERIOR_MAX_ENV_CELLS}
							max={MAX_STRUCTURED_INTERIOR_MAX_ENV_CELLS}
							step="1"
							value={$frontendState.browserMode.structuredInteriorMaxEnvCells}
							oninput={handleStructuredInteriorMaxEnvCellsInput}
						/>
					</label>

					<label
						class="browser-form__field browser-form__field--range"
						for="interior-depth-input"
					>
						<span>Max depth</span>
						<strong>
							{$frontendState.browserMode.structuredInteriorMaxVisibleCellDepth} hops
						</strong>
						<input
							id="interior-depth-input"
							type="range"
							min={MIN_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH}
							max={MAX_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH}
							step="1"
							value={$frontendState.browserMode
								.structuredInteriorMaxVisibleCellDepth}
							oninput={handleStructuredInteriorMaxVisibleCellDepthInput}
						/>
					</label>
				</div>
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
						<small>Show env-cell markers, bounds, axes, and labels.</small>
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
			<dl class="data-list compact-data-list">
				{#each sceneRows as row}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
		</div>
	{:else if !isCollapsed}
		<div class="browser-panel__body" role="tabpanel">
			<dl class="data-list compact-data-list">
				{#each debugRows as row}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
		</div>
	{/if}
</section>
