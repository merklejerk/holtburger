<script lang="ts">
	import DisplaySettingsControls from "./DisplaySettingsControls.svelte";
	import UiRange from "../ui/UiRange.svelte";
	import {
		SHARED_GRAPHICS_DEFAULTS,
		SHARED_GRAPHICS_RANGES,
		type SharedGraphicsSettings,
	} from "./shared-settings-contract";
	import { ENTITY_SHADOW_MODES } from "../../lib/game/renderer/shadows/entity-shadow-modes";
	import {
		resolveTextureFilteringPolicy,
		supportedTextureFilteringPolicies,
		type TextureFilteringCapabilities,
	} from "../../lib/game/renderer/webgl2/texture-filtering-policy";
	import "./settings-controls.css";

	interface Props {
		/** Saved graphics choices shared across Client, pregame, and Explorer. */
		readonly graphics: SharedGraphicsSettings;
		/** Actual device support; null until renderer initialization completes. */
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		/** Client exposes a single view-distance slider; Explorer owns per-layer radii in Scene. */
		readonly showViewDistance?: boolean;
		readonly onGraphicsChange: (graphics: SharedGraphicsSettings) => void;
	}

	let {
		graphics,
		textureFilteringCapabilities,
		showViewDistance = true,
		onGraphicsChange,
	}: Props = $props();

	let supportedFiltering = $derived(
		textureFilteringCapabilities === null
			? []
			: supportedTextureFilteringPolicies(textureFilteringCapabilities),
	);
	let effectiveFiltering = $derived(
		textureFilteringCapabilities === null
			? null
			: resolveTextureFilteringPolicy(
					graphics.textureFiltering,
					textureFilteringCapabilities,
				),
	);
	const renderScales = [0.5, 0.75, 1, 1.5, 2] as const;

	function resetGraphics(): void {
		onGraphicsChange(
			showViewDistance
				? SHARED_GRAPHICS_DEFAULTS
				: {
						...SHARED_GRAPHICS_DEFAULTS,
						viewDistance: graphics.viewDistance,
					},
		);
	}
</script>

<div class="settings-section">
	<DisplaySettingsControls />
	{#if showViewDistance}
		<label
			>View distance: {graphics.viewDistance} landblocks
			<UiRange
				min={SHARED_GRAPHICS_RANGES.viewDistance.minimum}
				max={SHARED_GRAPHICS_RANGES.viewDistance.maximum}
				step={SHARED_GRAPHICS_RANGES.viewDistance.step}
				value={graphics.viewDistance}
				onchange={(event) =>
					onGraphicsChange({
						...graphics,
						viewDistance: event.currentTarget.valueAsNumber,
					})}
			/>
		</label>
	{/if}
	<label
		>Field of view: {graphics.verticalFovDegrees}°
		<UiRange
			min={SHARED_GRAPHICS_RANGES.verticalFovDegrees.minimum}
			max={SHARED_GRAPHICS_RANGES.verticalFovDegrees.maximum}
			step={SHARED_GRAPHICS_RANGES.verticalFovDegrees.step}
			value={graphics.verticalFovDegrees}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					verticalFovDegrees: event.currentTarget.valueAsNumber,
				})}
		/>
	</label>
	<label
		>Dungeon ambient light: {Math.round(
			graphics.sealedInteriorAmbientLevel * 100,
		)}%
		<UiRange
			min={SHARED_GRAPHICS_RANGES.sealedInteriorAmbientLevel.minimum}
			max={SHARED_GRAPHICS_RANGES.sealedInteriorAmbientLevel.maximum}
			step={SHARED_GRAPHICS_RANGES.sealedInteriorAmbientLevel.step}
			value={graphics.sealedInteriorAmbientLevel}
			oninput={(event) =>
				onGraphicsChange({
					...graphics,
					sealedInteriorAmbientLevel: event.currentTarget.valueAsNumber,
				})}
		/>
	</label>
	<label class="ui-checkbox"
		><input
			type="checkbox"
			checked={graphics.ambientOcclusionEnabled}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					ambientOcclusionEnabled: event.currentTarget.checked,
				})}
		/> Ambient occlusion</label
	>
	<label
		>Entity shadows
		<select
			value={graphics.entityShadowMode}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					entityShadowMode: event.currentTarget
						.value as SharedGraphicsSettings["entityShadowMode"],
				})}
		>
			{#each ENTITY_SHADOW_MODES as mode}<option value={mode}
					>{mode === "none"
						? "Off"
						: mode === "simple"
							? "Simple"
							: "Shadow maps"}</option
				>{/each}
		</select>
	</label>
	<label
		>Texture filtering
		<select
			value={graphics.textureFiltering}
			disabled={textureFilteringCapabilities === null}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					textureFiltering: event.currentTarget
						.value as SharedGraphicsSettings["textureFiltering"],
				})}
		>
			{#if textureFilteringCapabilities === null}<option
					value={graphics.textureFiltering}>Detecting GPU…</option
				>{/if}
			{#if textureFilteringCapabilities !== null && effectiveFiltering !== graphics.textureFiltering}
				<option value={graphics.textureFiltering}
					>{graphics.textureFiltering} (saved; using {effectiveFiltering})</option
				>
			{/if}
			{#each supportedFiltering as mode}<option value={mode}>{mode}</option
				>{/each}
		</select>
	</label>
	<label
		>Render scale
		<select
			value={graphics.renderScale}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					renderScale: Number(event.currentTarget.value),
				})}
		>
			{#each renderScales as scale}<option value={scale}>{scale}×</option
				>{/each}
		</select>
	</label>
	<label class="ui-checkbox"
		><input
			type="checkbox"
			checked={graphics.weatherEnabled}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					weatherEnabled: event.currentTarget.checked,
				})}
		/> Weather</label
	>
	<button type="button" class="ui-button" onclick={resetGraphics}
		>Reset graphics</button
	>
</div>
