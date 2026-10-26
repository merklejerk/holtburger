<script lang="ts">
	import type { ClientGraphicsSettings } from "./client-settings-contract";
	import { CLIENT_GRAPHICS_RANGES } from "./client-settings-values";
	import { ENTITY_SHADOW_MODES } from "../lib/game/renderer/entity-shadow-modes";
	import {
		resolveTextureFilteringPolicy,
		supportedTextureFilteringPolicies,
		type TextureFilteringCapabilities,
	} from "../lib/game/renderer/texture-filtering-policy";
	import "./client-settings-controls.css";
	interface Props {
		/** Saved gameplay graphics choices, also inherited by pregame where applicable. */
		readonly graphics: ClientGraphicsSettings;
		/** Actual device support; null until renderer initialization completes. */
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
	}
	let { graphics, textureFilteringCapabilities, onGraphicsChange }: Props =
		$props();
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
</script>

<div class="settings-section">
	<label
		>View distance: {graphics.viewDistance} landblocks
		<input
			type="range"
			min={CLIENT_GRAPHICS_RANGES.viewDistance.minimum}
			max={CLIENT_GRAPHICS_RANGES.viewDistance.maximum}
			step={CLIENT_GRAPHICS_RANGES.viewDistance.step}
			value={graphics.viewDistance}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					viewDistance: event.currentTarget.valueAsNumber,
				})}
		/>
	</label>
	<p class="ui-muted">
		Terrain and buildings extend to this distance; smaller objects stay nearby.
	</p>
	<label
		>Field of view: {graphics.verticalFovDegrees}°
		<input
			type="range"
			min={CLIENT_GRAPHICS_RANGES.verticalFovDegrees.minimum}
			max={CLIENT_GRAPHICS_RANGES.verticalFovDegrees.maximum}
			step={CLIENT_GRAPHICS_RANGES.verticalFovDegrees.step}
			value={graphics.verticalFovDegrees}
			onchange={(event) =>
				onGraphicsChange({
					...graphics,
					verticalFovDegrees: event.currentTarget.valueAsNumber,
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
						.value as ClientGraphicsSettings["entityShadowMode"],
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
						.value as ClientGraphicsSettings["textureFiltering"],
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
</div>
