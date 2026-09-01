<script lang="ts">
	import ToggleField from "../app/ToggleField.svelte";
	import {
		createAmbientOcclusionParameters,
		type AmbientOcclusionParameters,
		type AmbientOcclusionSettings,
	} from "../lib/game/renderer/ambient-occlusion-policy";
	import type { EntityShadowSettings } from "../lib/game/renderer/entity-shadow-policy";
	import {
		NAMEPLATE_CATEGORIES,
		type NameplateCategory,
		type NameplateSettings,
	} from "../lib/game/renderer/nameplate-policy";
	import type {
		EnvCellRenderMode,
		RenderLayerVisibility,
	} from "../lib/game/renderer/renderer";
	import {
		textureFilteringPolicyLabel,
		type TextureFilteringPolicy,
	} from "../lib/game/renderer/texture-filtering-policy";
	import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
	import ExplorerControlGroup from "./ExplorerControlGroup.svelte";
	import ExplorerShadowControls from "./ExplorerShadowControls.svelte";

	interface Props {
		readonly runtimeReady: boolean;
		/** Explorer-local switch controlling distance-fog presentation. */
		readonly distanceFogEnabled: boolean;
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly viewerLightEnabled: boolean;
		readonly updateViewerLight: (enabled: boolean) => void;
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
		readonly nameplates: NameplateSettings;
		readonly updateNameplateCategory: (
			category: NameplateCategory,
			visible: boolean,
		) => void;
		/** User-switchable near-field ambient-occlusion presentation. */
		readonly ambientOcclusion: AmbientOcclusionSettings;
		readonly updateAmbientOcclusionSettings: (
			settings: AmbientOcclusionSettings,
		) => void;
		/** Complete outdoor and indoor entity-shadow presentation policy. */
		readonly entityShadows: EntityShadowSettings;
		readonly updateEntityShadowSettings: (
			settings: EntityShadowSettings,
		) => void;
		/** Effective filterable texture quality selected for the next frame. */
		readonly textureFiltering: TextureFilteringPolicy;
		/** Device-supported texture filtering choices in display order. */
		readonly textureFilteringOptions: readonly TextureFilteringPolicy[];
		/** Raw device maximum reported independently from the client 8x ceiling. */
		readonly maximumTextureAnisotropy: number | null;
		readonly updateTextureFiltering: (policy: TextureFilteringPolicy) => void;
		/** Device pixels rendered per CSS pixel, and the only anti-aliasing control we have. */
		readonly renderScale: number;
		/** Frontend-chosen densities offered to the viewer, not the renderer's full range. */
		readonly renderScaleOptions: readonly number[];
		readonly updateRenderScale: (renderScale: number) => void;
	}

	let {
		runtimeReady,
		distanceFogEnabled,
		updateDistanceFog,
		viewerLightEnabled,
		updateViewerLight,
		envCellRenderMode,
		updateEnvCellRenderMode,
		layerVisibility,
		updateLayerVisibility,
		showRetailHiddenGeometry,
		updateShowRetailHiddenGeometry,
		nameplates,
		updateNameplateCategory,
		ambientOcclusion,
		updateAmbientOcclusionSettings,
		entityShadows,
		updateEntityShadowSettings,
		textureFiltering,
		textureFilteringOptions,
		maximumTextureAnisotropy,
		updateTextureFiltering,
		renderScale,
		renderScaleOptions,
		updateRenderScale,
	}: Props = $props();

	const renderLayers = [
		{ kind: LandblockLayerKind.Terrain, label: "Terrain" },
		{ kind: LandblockLayerKind.Buildings, label: "Buildings" },
		{ kind: LandblockLayerKind.Objects, label: "Explicit objects" },
		{ kind: LandblockLayerKind.Generated, label: "Generated scenery" },
		{ kind: LandblockLayerKind.EnvCells, label: "Environment cells" },
	] as const;

	function updateAmbientOcclusionEnabled(enabled: boolean): void {
		updateAmbientOcclusionSettings({ ...ambientOcclusion, enabled });
	}

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

<div class="explorer-control-groups explorer-renderer-panel">
	<ExplorerControlGroup
		title="Scene visibility"
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
	</ExplorerControlGroup>

	<ExplorerControlGroup title="Nameplates" disabled={!runtimeReady}>
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

	<ExplorerControlGroup
		title="Lighting and atmosphere"
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
			checked={envCellRenderMode === "portal"}
			label="Portal rendering"
			checkedLabel="On"
			uncheckedLabel="Off"
			onCheckedChange={(checked) =>
				updateEnvCellRenderMode(checked ? "portal" : "flat")}
		/>
	</ExplorerControlGroup>

	<ExplorerControlGroup title="Ambient occlusion" disabled={!runtimeReady}>
		<ToggleField
			checked={ambientOcclusion.enabled}
			label="Near-field ambient occlusion"
			checkedLabel="On"
			uncheckedLabel="Off"
			onCheckedChange={updateAmbientOcclusionEnabled}
		/>
		<label class="explorer-environment-field">
			<span>Strength ({ambientOcclusion.parameters.intensity.toFixed(2)})</span>
			<input
				max="8"
				min="0"
				step="0.1"
				type="range"
				value={ambientOcclusion.parameters.intensity}
				oninput={(event) => updateAmbientOcclusionParameter("intensity", event)}
			/>
		</label>
		<label class="explorer-environment-field">
			<span>Radius ({ambientOcclusion.parameters.sampleRadius.toFixed(2)})</span
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

	<ExplorerControlGroup title="Sampling" disabled={!runtimeReady}>
		<label class="explorer-environment-field">
			<span>Render scale</span>
			<select
				class="ac-control ac-control--select"
				value={renderScale}
				onchange={(event) =>
					updateRenderScale(
						Number((event.currentTarget as HTMLSelectElement).value),
					)}
			>
				{#each renderScaleOptions as scale}
					<option value={scale}>{scale}x</option>
				{/each}
			</select>
		</label>
		<p class="explorer-control-note">
			Above 1x supersamples, which is the only anti-aliasing there is. Cost
			scales with its square.
		</p>
		<label class="explorer-environment-field">
			<span>Texture filtering</span>
			<select
				class="ac-control ac-control--select"
				disabled={maximumTextureAnisotropy === null}
				value={textureFiltering}
				onchange={(event) =>
					updateTextureFiltering(
						(event.currentTarget as HTMLSelectElement)
							.value as TextureFilteringPolicy,
					)}
			>
				{#each textureFilteringOptions as policy}
					<option value={policy}>{textureFilteringPolicyLabel(policy)}</option>
				{/each}
			</select>
		</label>
		<p class="explorer-control-note">
			Device maximum:
			{maximumTextureAnisotropy === null
				? "detecting"
				: maximumTextureAnisotropy > 1
					? `${maximumTextureAnisotropy}x`
					: "linear only"}
		</p>
	</ExplorerControlGroup>
</div>
