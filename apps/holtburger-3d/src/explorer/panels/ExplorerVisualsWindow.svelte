<script lang="ts">
	import ToggleField from "../../app/ui/ToggleField.svelte";
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import {
		NAMEPLATE_CATEGORIES,
		type NameplateCategory,
		type NameplateSettings,
	} from "../../lib/game/renderer/overlays/nameplate-policy";
	import {
		createAmbientOcclusionParameters,
		type AmbientOcclusionParameters,
		type AmbientOcclusionSettings,
	} from "../../lib/game/renderer/passes/ambient-occlusion-policy";
	import type { ColorGradeSettings } from "../../lib/game/renderer/passes/color-grade-policy";
	import type {
		EnvCellRenderMode,
		RenderLayerVisibility,
	} from "../../lib/game/renderer/renderer";
	import type { EntityShadowSettings } from "../../lib/game/renderer/shadows/entity-shadow-policy";
	import { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";
	import ExplorerControlGroup from "./ExplorerControlGroup.svelte";
	import ExplorerGradingPanel from "./ExplorerGradingPanel.svelte";
	import ExplorerShadowControls from "./ExplorerShadowControls.svelte";

	type VisualsTab = "visibility" | "lighting" | "grading";

	interface Props {
		readonly runtimeReady: boolean;
		readonly distanceFogEnabled: boolean;
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly viewerLightEnabled: boolean;
		readonly updateViewerLight: (enabled: boolean) => void;
		readonly staticLightsEnabled: boolean;
		readonly updateStaticLights: (enabled: boolean) => void;
		readonly envCellRenderMode: EnvCellRenderMode;
		readonly updateEnvCellRenderMode: (mode: EnvCellRenderMode) => void;
		/** Renderer-only layer switches; these do not alter requested scene interest. */
		readonly layerVisibility: RenderLayerVisibility;
		readonly updateLayerVisibility: (
			layer: LandblockLayerKind,
			visible: boolean,
		) => void;
		/** Whether meshes suppressed by retail's degradation sentinel remain visible. */
		readonly showRetailHiddenGeometry: boolean;
		readonly updateShowRetailHiddenGeometry: (visible: boolean) => void;
		readonly showNameplates: boolean;
		readonly nameplates: NameplateSettings;
		readonly updateNameplateCategory: (
			category: NameplateCategory,
			visible: boolean,
		) => void;
		readonly ambientOcclusion: AmbientOcclusionSettings;
		readonly updateAmbientOcclusionSettings: (
			settings: AmbientOcclusionSettings,
		) => void;
		readonly entityShadows: EntityShadowSettings;
		readonly updateEntityShadowSettings: (
			settings: EntityShadowSettings,
		) => void;
		readonly colorGrade: ColorGradeSettings;
		readonly updateColorGrade: (settings: ColorGradeSettings) => void;
	}

	const {
		runtimeReady,
		distanceFogEnabled,
		updateDistanceFog,
		viewerLightEnabled,
		updateViewerLight,
		staticLightsEnabled,
		updateStaticLights,
		envCellRenderMode,
		updateEnvCellRenderMode,
		layerVisibility,
		updateLayerVisibility,
		showRetailHiddenGeometry,
		updateShowRetailHiddenGeometry,
		showNameplates,
		nameplates,
		updateNameplateCategory,
		ambientOcclusion,
		updateAmbientOcclusionSettings,
		entityShadows,
		updateEntityShadowSettings,
		colorGrade,
		updateColorGrade,
	}: Props = $props();

	let activeTab = $state<VisualsTab>("visibility");

	const tabs = [
		{
			value: "visibility" as const,
			label: "Visibility",
			id: "explorer-visuals-visibility-tab",
			panelId: "explorer-visuals-visibility-panel",
		},
		{
			value: "lighting" as const,
			label: "Lighting",
			id: "explorer-visuals-lighting-tab",
			panelId: "explorer-visuals-lighting-panel",
		},
		{
			value: "grading" as const,
			label: "Grading",
			id: "explorer-visuals-grading-tab",
			panelId: "explorer-visuals-grading-panel",
		},
	] as const;

	const renderLayers = [
		{ kind: LandblockLayerKind.Terrain, label: "Terrain" },
		{ kind: LandblockLayerKind.Buildings, label: "Buildings" },
		{ kind: LandblockLayerKind.Objects, label: "Explicit objects" },
		{ kind: LandblockLayerKind.Generated, label: "Generated scenery" },
		{ kind: LandblockLayerKind.EnvCells, label: "Environment cells" },
	] as const;

	function updateAmbientOcclusionParameter(
		field: keyof AmbientOcclusionParameters,
		event: Event,
	): void {
		const parameters = createAmbientOcclusionParameters({
			...ambientOcclusion.parameters,
			[field]: Number((event.currentTarget as HTMLInputElement).value),
		});
		updateAmbientOcclusionSettings({ ...ambientOcclusion, parameters });
	}
</script>

<div class="explorer-visuals-window ui-tabbed-panel ui-body">
	<UiTabs
		{tabs}
		selected={activeTab}
		label="Visuals sections"
		onSelect={(value) => (activeTab = value)}
	/>
	<UiTabPanel
		id="explorer-visuals-visibility-panel"
		labelledBy="explorer-visuals-visibility-tab"
		active={activeTab === "visibility"}
	>
		<div class="explorer-control-groups">
			<ExplorerControlGroup
				title="Scene layers"
				initiallyOpen
				disabled={!runtimeReady}
			>
				{#each renderLayers as layer (layer.kind)}
					<ToggleField
						checked={layerVisibility[layer.kind]}
						label={layer.label}
						checkedLabel="Shown"
						uncheckedLabel="Hidden"
						onCheckedChange={(visible) =>
							updateLayerVisibility(layer.kind, visible)}
					/>
				{/each}
				<ToggleField
					checked={showRetailHiddenGeometry}
					label="Retail-hidden geometry"
					checkedLabel="Shown"
					uncheckedLabel="Hidden"
					onCheckedChange={updateShowRetailHiddenGeometry}
				/>
				<ToggleField
					checked={envCellRenderMode === "portal"}
					label="Portal rendering"
					checkedLabel="On"
					uncheckedLabel="Off"
					onCheckedChange={(checked) =>
						updateEnvCellRenderMode(checked ? "portal" : "flat")}
				/>
			</ExplorerControlGroup>

			<ExplorerControlGroup
				title="Nameplates"
				disabled={!runtimeReady || !showNameplates}
			>
				{#each NAMEPLATE_CATEGORIES as category (category)}
					<ToggleField
						checked={nameplates.categoryVisibility[category]}
						label={category === "selfPlayer" ? "Self player" : category}
						checkedLabel="Shown"
						uncheckedLabel="Hidden"
						onCheckedChange={(visible) =>
							updateNameplateCategory(category, visible)}
					/>
				{/each}
			</ExplorerControlGroup>
		</div>
	</UiTabPanel>

	<UiTabPanel
		id="explorer-visuals-lighting-panel"
		labelledBy="explorer-visuals-lighting-tab"
		active={activeTab === "lighting"}
	>
		<div class="explorer-control-groups">
			<ExplorerControlGroup
				title="Lights and atmosphere"
				initiallyOpen
				disabled={!runtimeReady}
			>
				<ToggleField
					checked={distanceFogEnabled}
					label="Distance fog"
					checkedLabel="On"
					uncheckedLabel="Off"
					onCheckedChange={updateDistanceFog}
				/>
				<ToggleField
					checked={viewerLightEnabled}
					label="Viewer light"
					checkedLabel="On"
					uncheckedLabel="Off"
					onCheckedChange={updateViewerLight}
				/>
				<ToggleField
					checked={staticLightsEnabled}
					label="Static outdoor lights"
					checkedLabel="On"
					uncheckedLabel="Off"
					onCheckedChange={updateStaticLights}
				/>
			</ExplorerControlGroup>

			<ExplorerControlGroup title="Ambient occlusion" disabled={!runtimeReady}>
				<label class="explorer-environment-field">
					<span
						>Strength ({ambientOcclusion.parameters.intensity.toFixed(2)})</span
					>
					<input
						max="8"
						min="0"
						step="0.1"
						type="range"
						value={ambientOcclusion.parameters.intensity}
						oninput={(event) =>
							updateAmbientOcclusionParameter("intensity", event)}
					/>
				</label>
				<label class="explorer-environment-field">
					<span
						>Radius ({ambientOcclusion.parameters.sampleRadius.toFixed(
							2,
						)})</span
					>
					<input
						max="8"
						min={ambientOcclusion.parameters.bias + 0.05}
						step="0.05"
						type="range"
						value={ambientOcclusion.parameters.sampleRadius}
						oninput={(event) =>
							updateAmbientOcclusionParameter("sampleRadius", event)}
					/>
				</label>
				<label class="explorer-environment-field">
					<span>Bias ({ambientOcclusion.parameters.bias.toFixed(2)})</span>
					<input
						max={ambientOcclusion.parameters.sampleRadius - 0.05}
						min="0"
						step="0.01"
						type="range"
						value={ambientOcclusion.parameters.bias}
						oninput={(event) => updateAmbientOcclusionParameter("bias", event)}
					/>
				</label>
				<label class="explorer-environment-field">
					<span
						>Edge threshold ({ambientOcclusion.parameters.bilateralDepthThreshold.toFixed(
							2,
						)})</span
					>
					<input
						max="4"
						min="0.05"
						step="0.05"
						type="range"
						value={ambientOcclusion.parameters.bilateralDepthThreshold}
						oninput={(event) =>
							updateAmbientOcclusionParameter("bilateralDepthThreshold", event)}
					/>
				</label>
			</ExplorerControlGroup>

			<ExplorerControlGroup title="Entity shadows" disabled={!runtimeReady}>
				<ExplorerShadowControls
					settings={entityShadows}
					updateSettings={updateEntityShadowSettings}
				/>
			</ExplorerControlGroup>
		</div>
	</UiTabPanel>

	<UiTabPanel
		id="explorer-visuals-grading-panel"
		labelledBy="explorer-visuals-grading-tab"
		active={activeTab === "grading"}
	>
		<ExplorerGradingPanel
			{colorGrade}
			updateColorGradeSettings={updateColorGrade}
		/>
	</UiTabPanel>
</div>

<style>
	@layer components {
		.explorer-visuals-window {
			height: 100%;
			min-height: 0;
		}
	}
</style>
