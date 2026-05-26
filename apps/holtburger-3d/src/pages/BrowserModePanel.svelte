<script lang="ts">
	import { frontendState } from "../app/frontend-state";
	import {
		browserLocationToLandblockId,
		isLandblockPrefixInput,
		MAX_BROWSER_LOD_RADIUS,
		MAX_TRANSITION_PORTAL_MAX_DEPTH,
		MIN_BROWSER_LOD_RADIUS,
		MIN_TRANSITION_PORTAL_MAX_DEPTH,
		type BrowserRenderStyle,
		type BrowserNavigationFocusMode,
		type BrowserTextureFilteringMode,
	} from "../app/browser-mode";
	import { formatHex32, normalizeOutdoorLandblockId } from "../lib/landblocks";
	import { countOutdoorSceneLodTiles } from "../lib/world-display/outdoor-scene-interest";
	import type { RuntimeAppearanceRequestDto } from "../lib/host/contracts";

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
		sceneDetailSections,
		debugSummaryRows,
		debugDetailSections,
		runtimeAppearanceStatusText,
		runtimeAppearanceRows,
		canResetCamera,
		onResetCamera,
		onRuntimeAppearanceSubmit,
		onRuntimeAppearanceClear,
	}: {
		sceneStatusText: string;
		sceneSummaryRows: BrowserPanelRow[];
		sceneDetailSections: BrowserPanelSection[];
		debugSummaryRows: BrowserPanelRow[];
		debugDetailSections: BrowserPanelSection[];
		runtimeAppearanceStatusText: string;
		runtimeAppearanceRows: BrowserPanelRow[];
		canResetCamera: boolean;
		onResetCamera: () => void;
		onRuntimeAppearanceSubmit: (request: RuntimeAppearanceRequestDto) => void;
		onRuntimeAppearanceClear: () => void;
	} = $props();

	let activeTab = $state<BrowserPanelTabId>("navigate");
	let isCollapsed = $state(false);
	let previewSetupDid = $state("02000001");
	let previewPaletteId = $state("");
	let previewSubPalettes = $state<
		{ subId: string; offset: string; numColors: string }[]
	>([]);
	let previewTextureChanges = $state<
		{ partIndex: string; oldTexture: string; newTexture: string }[]
	>([]);
	let previewAnimPartChanges = $state<{ partIndex: string; partId: string }[]>(
		[],
	);
	let previewValidationMessage = $state<string | null>(null);
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

	function submitRuntimeAppearance(event?: SubmitEvent): void {
		event?.preventDefault();
		try {
			const setupModelId = parseHexInput(previewSetupDid, "setupDid");
			const paletteId =
				previewPaletteId.trim().length === 0
					? null
					: parseHexInput(previewPaletteId, "palette ID");
			onRuntimeAppearanceSubmit({
				setupModelId,
				objDesc: {
					paletteId,
					subPalettes: previewSubPalettes.map((row) => ({
						subId: parseHexInput(row.subId, "subpalette ID"),
						offset: parseDecimalInput(row.offset, "subpalette offset"),
						numColors: parseDecimalInput(row.numColors, "subpalette size"),
					})),
					textureChanges: previewTextureChanges.map((row) => ({
						partIndex: parseDecimalInput(row.partIndex, "texture part"),
						oldTexture: parseHexInput(row.oldTexture, "old texture"),
						newTexture: parseHexInput(row.newTexture, "new texture"),
					})),
					animPartChanges: previewAnimPartChanges.map((row) => ({
						partIndex: parseDecimalInput(row.partIndex, "animation part"),
						partId: parseHexInput(row.partId, "part ID"),
					})),
				},
			});
			previewValidationMessage = null;
		} catch (error) {
			previewValidationMessage =
				error instanceof Error ? error.message : String(error);
		}
	}

	function addSubPaletteRow(): void {
		previewSubPalettes = [
			...previewSubPalettes,
			{ subId: "", offset: "0", numColors: "0" },
		];
	}

	function addTextureChangeRow(): void {
		previewTextureChanges = [
			...previewTextureChanges,
			{ partIndex: "0", oldTexture: "", newTexture: "" },
		];
	}

	function addAnimPartChangeRow(): void {
		previewAnimPartChanges = [
			...previewAnimPartChanges,
			{ partIndex: "0", partId: "" },
		];
	}

	function removeSubPaletteRow(index: number): void {
		previewSubPalettes = previewSubPalettes.filter(
			(_row, rowIndex) => rowIndex !== index,
		);
	}

	function removeTextureChangeRow(index: number): void {
		previewTextureChanges = previewTextureChanges.filter(
			(_row, rowIndex) => rowIndex !== index,
		);
	}

	function removeAnimPartChangeRow(index: number): void {
		previewAnimPartChanges = previewAnimPartChanges.filter(
			(_row, rowIndex) => rowIndex !== index,
		);
	}

	function parseHexInput(value: string, label: string): number {
		const normalized = value.trim().replace(/^0x/i, "");
		if (!/^[0-9a-fA-F]+$/.test(normalized)) {
			throw new Error(`${label} must be hexadecimal.`);
		}
		return Number.parseInt(normalized, 16);
	}

	function parseDecimalInput(value: string, label: string): number {
		const normalized = value.trim();
		if (!/^\d+$/.test(normalized)) {
			throw new Error(`${label} must be a non-negative integer.`);
		}
		return Number.parseInt(normalized, 10);
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
				<legend>Texture filtering</legend>
				<label class="browser-form__field" for="texture-filtering-mode">
					<span>Maximum mode</span>
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
			<div class="browser-panel__section-stack">
				{#each sceneDetailSections as section}
					<details class="browser-panel__details">
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
		</div>
	{:else if !isCollapsed}
		<div class="browser-panel__body" role="tabpanel">
			<form class="browser-form" onsubmit={submitRuntimeAppearance}>
				<fieldset class="browser-form__fieldset">
					<legend>Runtime appearance</legend>
					<p class="browser-panel__status">{runtimeAppearanceStatusText}</p>
					<label class="browser-form__field" for="appearance-preview-setup">
						<span>Setup DID</span>
						<input
							id="appearance-preview-setup"
							type="text"
							bind:value={previewSetupDid}
							placeholder="02000001"
							spellcheck="false"
						/>
					</label>
					<label class="browser-form__field" for="appearance-preview-palette">
						<span>Palette ID</span>
						<input
							id="appearance-preview-palette"
							type="text"
							bind:value={previewPaletteId}
							placeholder="optional"
							spellcheck="false"
						/>
					</label>

					<div class="browser-form__row-header">
						<span>Subpalettes</span>
						<button type="button" onclick={addSubPaletteRow}>Add</button>
					</div>
					{#each previewSubPalettes as row, index}
						<div class="browser-form__inline-row">
							<input bind:value={row.subId} placeholder="sub ID" />
							<input bind:value={row.offset} placeholder="offset" />
							<input bind:value={row.numColors} placeholder="count" />
							<button type="button" onclick={() => removeSubPaletteRow(index)}>
								Remove
							</button>
						</div>
					{/each}

					<div class="browser-form__row-header">
						<span>Texture swaps</span>
						<button type="button" onclick={addTextureChangeRow}>Add</button>
					</div>
					{#each previewTextureChanges as row, index}
						<div class="browser-form__inline-row">
							<input bind:value={row.partIndex} placeholder="part" />
							<input bind:value={row.oldTexture} placeholder="old tex" />
							<input bind:value={row.newTexture} placeholder="new tex" />
							<button
								type="button"
								onclick={() => removeTextureChangeRow(index)}
							>
								Remove
							</button>
						</div>
					{/each}

					<div class="browser-form__row-header">
						<span>Part swaps</span>
						<button type="button" onclick={addAnimPartChangeRow}>Add</button>
					</div>
					{#each previewAnimPartChanges as row, index}
						<div class="browser-form__inline-row">
							<input bind:value={row.partIndex} placeholder="part" />
							<input bind:value={row.partId} placeholder="part DID" />
							<button
								type="button"
								onclick={() => removeAnimPartChangeRow(index)}
							>
								Remove
							</button>
						</div>
					{/each}

					<div class="browser-form__actions">
						<button type="submit">Preview</button>
						<button type="button" onclick={onRuntimeAppearanceClear}>
							Clear
						</button>
					</div>
					{#if previewValidationMessage}
						<p class="validation-message">{previewValidationMessage}</p>
					{/if}
					{#if runtimeAppearanceRows.length > 0}
						<dl class="data-list compact-data-list">
							{#each runtimeAppearanceRows as row}
								<div>
									<dt>{row.label}</dt>
									<dd>{row.value}</dd>
								</div>
							{/each}
						</dl>
					{/if}
				</fieldset>
			</form>
			<dl class="data-list compact-data-list browser-panel__summary-list">
				{#each debugSummaryRows as row}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
			<div class="browser-panel__section-stack">
				{#each debugDetailSections as section}
					<details class="browser-panel__details">
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
		</div>
	{/if}
</section>
