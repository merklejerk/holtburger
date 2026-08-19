<script lang="ts">
	import type { SceneResidency } from "../lib/game/scene";
	import type { SceneInterestRadii } from "../lib/game/runtime/types";
	import { FRONTEND_TUNING } from "../lib/frontend-tuning";
	import type { ExplorerCameraFocusStatus } from "./explorer-camera-coordinator";
	import {
		formatResidencyRadius,
		updateExplorerResidencyRadius,
		type ExplorerRadiusKind,
	} from "./explorer-residency-radius";
	import { parseResidenceInput } from "./world-input";
	import type { ExplorerEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import type {
		EnvCellRenderMode,
		RenderLayerVisibility,
	} from "../lib/game/renderer/renderer";
	import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
	import ExplorerLayerVisibilityButton from "./ExplorerLayerVisibilityButton.svelte";
	import {
		textureFilteringPolicyLabel,
		type TextureFilteringPolicy,
	} from "../lib/game/renderer/texture-filtering-policy";
	import {
		createAmbientOcclusionParameters,
		type AmbientOcclusionParameters,
		type AmbientOcclusionSettings,
	} from "../lib/game/renderer/ambient-occlusion-policy";
	import type { PhysicalCameraStatus } from "./physical-camera-session";
	import type { ExplorerCameraMode } from "../lib/game/motion/host-physical-camera-path";

	interface Props {
		/** Whether Explorer has a runtime available to accept world operations. */
		readonly runtimeReady: boolean;
		/** Request frontend-owned scene content and automatic Explorer camera placement. */
		readonly requestSceneInterest: (
			residency: SceneResidency,
			radii: SceneInterestRadii,
		) => void;
		/** Current automatic camera-placement lifecycle state. */
		readonly cameraFocusStatus: ExplorerCameraFocusStatus;
		readonly cameraMode: ExplorerCameraMode;
		readonly cameraModePending: boolean;
		readonly physicalCameraStatus: PhysicalCameraStatus | null;
		readonly physicalCameraError: string | null;
		readonly updateCameraMode: (mode: ExplorerCameraMode) => void;
		readonly environmentSelection: ExplorerEnvironmentSelection;
		readonly dayGroupNames: readonly string[];
		readonly updateEnvironment: (
			selection: ExplorerEnvironmentSelection,
		) => void;
		/** Explorer-local switch controlling distance-fog presentation. */
		readonly distanceFogEnabled: boolean;
		/** User-switchable near-field ambient-occlusion presentation. */
		readonly ambientOcclusion: AmbientOcclusionSettings;
		readonly viewerLightEnabled: boolean;
		/** Mirrors retail's `DisableMostWeatherEffects` player option, inverted. */
		readonly weatherEnabled: boolean;
		readonly clockFollowing: boolean;
		/** Follow mode: scene interest re-anchors to the camera's landblock on crossings. */
		readonly interestFollowsCamera: boolean;
		readonly updateInterestFollowsCamera: (enabled: boolean) => void;
		/** Whether the audio listener rides the free camera; see the camera coordinator. */
		readonly audioFollowsCamera: boolean;
		/** Effect-category volume in [0, 1]; retail's other categories are not produced yet. */
		readonly effectVolume: number;
		readonly ambientVolume: number;
		/** Update Explorer's distance-fog presentation switch. */
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly updateAmbientOcclusionSettings: (
			settings: AmbientOcclusionSettings,
		) => void;
		readonly updateViewerLight: (enabled: boolean) => void;
		readonly updateWeather: (enabled: boolean) => void;
		readonly updateClockFollowing: (enabled: boolean) => void;
		readonly updateAudioFollowsCamera: (enabled: boolean) => void;
		readonly updateEffectVolume: (volume: number) => void;
		readonly updateAmbientVolume: (volume: number) => void;
		readonly envCellRenderMode: EnvCellRenderMode;
		readonly updateEnvCellRenderMode: (mode: EnvCellRenderMode) => void;
		/** Renderer-only layer switches; these do not alter requested scene interest. */
		readonly layerVisibility: RenderLayerVisibility;
		readonly updateLayerVisibility: (
			layer: LandblockLayerKind,
			visible: boolean,
		) => void;
		/** Effective filterable texture quality selected for the next frame. */
		readonly textureFiltering: TextureFilteringPolicy;
		/** Device-supported texture filtering choices in display order. */
		readonly textureFilteringOptions: readonly TextureFilteringPolicy[];
		/** Raw device maximum reported independently from the client 8x ceiling. */
		readonly maximumTextureAnisotropy: number | null;
		readonly updateTextureFiltering: (policy: TextureFilteringPolicy) => void;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		cameraFocusStatus,
		cameraMode,
		cameraModePending,
		physicalCameraStatus,
		physicalCameraError,
		updateCameraMode,
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
		distanceFogEnabled,
		ambientOcclusion,
		viewerLightEnabled,
		weatherEnabled,
		clockFollowing,
		interestFollowsCamera,
		updateInterestFollowsCamera,
		audioFollowsCamera,
		updateAudioFollowsCamera,
		effectVolume,
		ambientVolume,
		updateEffectVolume,
		updateAmbientVolume,
		updateDistanceFog,
		updateAmbientOcclusionSettings,
		updateViewerLight,
		updateWeather,
		updateClockFollowing,
		envCellRenderMode,
		updateEnvCellRenderMode,
		layerVisibility,
		updateLayerVisibility,
		textureFiltering,
		textureFilteringOptions,
		maximumTextureAnisotropy,
		updateTextureFiltering,
	}: Props = $props();

	let interestInput = $state("0000");
	let interestStatus = $state("No scene interest requested.");
	let radii = $state<SceneInterestRadii>({
		...FRONTEND_TUNING.explorer.residency.defaultRadii,
	});

	const parsedInterest = $derived(parseResidenceInput(interestInput));

	function submitInterest(event: SubmitEvent): void {
		event.preventDefault();
		if (!runtimeReady || !parsedInterest) return;
		requestSceneInterest(parsedInterest.residency, radii);
		interestStatus = `Requested around ${parsedInterest.residency.landblockId}.`;
	}

	function updateRadius(kind: ExplorerRadiusKind, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		radii = updateExplorerResidencyRadius(
			radii,
			kind,
			input.value === "-1" ? null : Number(input.value),
		);
	}

	function updateEnvironmentSelection(
		field: "dayIndex" | "timeOfDay" | "dayGroupOverride",
		event: Event,
	): void {
		const input = event.currentTarget as HTMLInputElement | HTMLSelectElement;
		const value = input.value;
		updateEnvironment({
			...environmentSelection,
			[field]:
				field === "dayGroupOverride"
					? value === "auto"
						? null
						: Number(value)
					: Number(value),
		});
	}

	function handleDistanceFogChange(event: Event): void {
		updateDistanceFog((event.currentTarget as HTMLInputElement).checked);
	}

	function handleAmbientOcclusionChange(event: Event): void {
		updateAmbientOcclusionSettings({
			...ambientOcclusion,
			enabled: (event.currentTarget as HTMLInputElement).checked,
		});
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

	function handleViewerLightChange(event: Event): void {
		updateViewerLight((event.currentTarget as HTMLInputElement).checked);
	}

	function handleWeatherChange(event: Event): void {
		updateWeather((event.currentTarget as HTMLInputElement).checked);
	}

	function handleClockFollowingChange(event: Event): void {
		updateClockFollowing((event.currentTarget as HTMLInputElement).checked);
	}

	function handleAudioFollowsCameraChange(event: Event): void {
		updateAudioFollowsCamera((event.currentTarget as HTMLInputElement).checked);
	}

	function handleInterestFollowsCameraChange(event: Event): void {
		updateInterestFollowsCamera(
			(event.currentTarget as HTMLInputElement).checked,
		);
	}

	function handleCameraModeChange(event: Event): void {
		updateCameraMode(
			(event.currentTarget as HTMLSelectElement).value as ExplorerCameraMode,
		);
	}

	const requestStatus = $derived(
		cameraFocusStatus === "No camera focus requested."
			? interestStatus
			: `${interestStatus} ${cameraFocusStatus}`,
	);
</script>

<div class="explorer-world-panel">
	<form class="explorer-world-form" onsubmit={submitInterest}>
		<fieldset class="explorer-section" disabled={!runtimeReady}>
			<legend>Scene interest</legend>
			<label class="explorer-form-field">
				<span>Target landblock, cell, or coordinates</span>
				<input
					class="explorer-control"
					autocomplete="off"
					bind:value={interestInput}
					placeholder="da55, da550123, or 33.6N 40W"
					spellcheck="false"
				/>
			</label>
			<p class:invalid={parsedInterest === null}>
				{parsedInterest?.label ??
					"Enter four or eight hexadecimal digits, or N/S E/W coordinates."}
			</p>
			<label class="explorer-toggle">
				<input
					checked={interestFollowsCamera}
					type="checkbox"
					onchange={handleInterestFollowsCameraChange}
				/>
				<span>Interest follows camera</span>
				<strong>{interestFollowsCamera ? "On" : "Off"}</strong>
			</label>
			<div
				class="explorer-residency-controls"
				aria-label="Scene interest level of detail"
			>
				<p class="ac-section-label">Outdoor residency</p>
				<div class="explorer-residency-control">
					<ExplorerLayerVisibilityButton
						label="terrain"
						visible={layerVisibility[LandblockLayerKind.Terrain]}
						updateVisible={(visible) =>
							updateLayerVisibility(LandblockLayerKind.Terrain, visible)}
					/>
					<label for="explorer-residency-terrain">Terrain</label>
					<strong>{formatResidencyRadius(radii.terrainRadius)}</strong>
					<input
						id="explorer-residency-terrain"
						max={FRONTEND_TUNING.explorer.residency.maximumRadius}
						min={FRONTEND_TUNING.explorer.residency.minimumRadius}
						step="1"
						type="range"
						value={radii.terrainRadius}
						oninput={(event) => updateRadius("terrain", event)}
					/>
				</div>
				<div class="explorer-residency-control">
					<ExplorerLayerVisibilityButton
						label="building"
						visible={layerVisibility[LandblockLayerKind.Buildings]}
						updateVisible={(visible) =>
							updateLayerVisibility(LandblockLayerKind.Buildings, visible)}
					/>
					<label for="explorer-residency-buildings">Buildings</label>
					<strong>{formatResidencyRadius(radii.buildingRadius)}</strong>
					<input
						id="explorer-residency-buildings"
						max={radii.terrainRadius}
						min="-1"
						step="1"
						type="range"
						value={radii.buildingRadius ?? -1}
						oninput={(event) => updateRadius("buildings", event)}
					/>
				</div>
				<div class="explorer-residency-control">
					<ExplorerLayerVisibilityButton
						label="explicit object"
						visible={layerVisibility[LandblockLayerKind.Objects]}
						updateVisible={(visible) =>
							updateLayerVisibility(LandblockLayerKind.Objects, visible)}
					/>
					<label for="explorer-residency-objects">Explicit objects</label>
					<strong>{formatResidencyRadius(radii.explicitObjectRadius)}</strong>
					<input
						id="explorer-residency-objects"
						disabled={radii.buildingRadius === null}
						max={radii.buildingRadius ?? -1}
						min="-1"
						step="1"
						type="range"
						value={radii.explicitObjectRadius ?? -1}
						oninput={(event) => updateRadius("explicitObjects", event)}
					/>
				</div>
				<div class="explorer-residency-control">
					<ExplorerLayerVisibilityButton
						label="generated scenery"
						visible={layerVisibility[LandblockLayerKind.Generated]}
						updateVisible={(visible) =>
							updateLayerVisibility(LandblockLayerKind.Generated, visible)}
					/>
					<label for="explorer-residency-generated">Generated scenery</label>
					<strong>{formatResidencyRadius(radii.generatedObjectRadius)}</strong>
					<input
						id="explorer-residency-generated"
						disabled={radii.buildingRadius === null}
						max={radii.buildingRadius ?? -1}
						min="-1"
						step="1"
						type="range"
						value={radii.generatedObjectRadius ?? -1}
						oninput={(event) => updateRadius("generatedObjects", event)}
					/>
				</div>
				<div class="explorer-residency-control">
					<ExplorerLayerVisibilityButton
						label="environment cell"
						visible={layerVisibility[LandblockLayerKind.EnvCells]}
						updateVisible={(visible) =>
							updateLayerVisibility(LandblockLayerKind.EnvCells, visible)}
					/>
					<label for="explorer-residency-env-cells">Env cells</label>
					<strong>{formatResidencyRadius(radii.envCellRadius)}</strong>
					<input
						id="explorer-residency-env-cells"
						max={radii.terrainRadius}
						min="-1"
						step="1"
						type="range"
						value={radii.envCellRadius ?? -1}
						oninput={(event) => updateRadius("envCells", event)}
					/>
				</div>
			</div>
			<button
				type="submit"
				class="explorer-action"
				disabled={parsedInterest === null}
			>
				Request content and focus
			</button>
			<p>{requestStatus}</p>
		</fieldset>
	</form>
	<fieldset
		class="explorer-section"
		disabled={!runtimeReady || cameraModePending}
	>
		<legend>Camera navigation</legend>
		<label class="explorer-form-field">
			<span>Position authority</span>
			<select
				class="explorer-control explorer-control--select"
				value={cameraMode}
				onchange={handleCameraModeChange}
			>
				<option value="free-fly">Frontend free fly</option>
				<option value="physical-fly">Host physical fly</option>
				<option value="grounded-walk">Host grounded walk</option>
			</select>
		</label>
		<p>
			{cameraModePending
				? "Loading collision content and placing the physical camera."
				: cameraMode !== "free-fly"
					? `Host ${physicalCameraStatus?.mode ?? cameraMode}: ${physicalCameraStatus?.tick ?? "awaiting-first-path"}; collision ${physicalCameraStatus?.sceneResidency?.state ?? "unknown"}; cell ${physicalCameraStatus?.cellId ?? "outdoor"}; ${physicalCameraStatus?.groundState ?? "unknown"}; ${physicalCameraStatus?.constraintCount ?? 0} solve constraints; ${physicalCameraStatus?.solveDurationMs.toFixed(2) ?? "0.00"} ms; ${physicalCameraStatus?.substeps ?? 0} substeps; ${physicalCameraStatus?.contactPasses ?? 0} contact passes; ${physicalCameraStatus?.droppedPaths ?? 0} dropped paths.`
					: "Free fly bypasses collision and remains the recovery mode."}
		</p>
		{#if physicalCameraStatus?.sceneResidency?.state === "missing-owner"}
			<p class="invalid">
				Collision owner {physicalCameraStatus.sceneResidency.landblockId} is not resident;
				motion continues through open space.
			</p>
		{:else if physicalCameraStatus?.sceneResidency?.state === "outside-landscape"}
			<p class="invalid">
				Camera is outside the authored landscape; motion continues through open
				space.
			</p>
		{/if}
		{#if physicalCameraError !== null}
			<p class="invalid">Physical camera failed: {physicalCameraError}</p>
		{/if}
	</fieldset>
	{#if dayGroupNames.length > 0}
		<fieldset
			class="explorer-section explorer-environment-controls"
			disabled={!runtimeReady}
		>
			<legend>Regional environment</legend>
			<label class="explorer-environment-field">
				<span>Day</span>
				<input
					class="explorer-control"
					min="0"
					step="1"
					type="number"
					value={environmentSelection.dayIndex}
					oninput={(event) => updateEnvironmentSelection("dayIndex", event)}
				/>
			</label>
			<label class="explorer-environment-field">
				<span>Time</span>
				<input
					max="0.999"
					min="0"
					step="0.01"
					type="range"
					value={environmentSelection.timeOfDay}
					oninput={(event) => updateEnvironmentSelection("timeOfDay", event)}
				/>
			</label>
			<label class="explorer-environment-field">
				<span>Sky group</span>
				<select
					class="explorer-control explorer-control--select"
					value={environmentSelection.dayGroupOverride ?? "auto"}
					onchange={(event) =>
						updateEnvironmentSelection("dayGroupOverride", event)}
				>
					<option value="auto">Auto</option>
					{#each dayGroupNames as name, index}
						<option value={index}>{name}</option>
					{/each}
				</select>
			</label>
			<label class="explorer-toggle">
				<input
					checked={distanceFogEnabled}
					type="checkbox"
					onchange={handleDistanceFogChange}
				/>
				<span>Distance fog</span>
				<strong>{distanceFogEnabled ? "On" : "Off"}</strong>
			</label>
			<label class="explorer-toggle">
				<input
					checked={viewerLightEnabled}
					type="checkbox"
					onchange={handleViewerLightChange}
				/>
				<span>Viewer light</span>
				<strong>{viewerLightEnabled ? "On" : "Off"}</strong>
			</label>
			<label class="explorer-toggle">
				<input
					checked={weatherEnabled}
					type="checkbox"
					onchange={handleWeatherChange}
				/>
				<span>Weather</span>
				<strong>{weatherEnabled ? "On" : "Off"}</strong>
			</label>
			<label class="explorer-toggle">
				<input
					checked={clockFollowing}
					type="checkbox"
					onchange={handleClockFollowingChange}
				/>
				<span>Follow clock</span>
				<strong>{clockFollowing ? "On" : "Off"}</strong>
			</label>
			<label class="explorer-toggle">
				<input
					checked={audioFollowsCamera}
					type="checkbox"
					onchange={handleAudioFollowsCameraChange}
				/>
				<span>Audio follows camera</span>
				<strong>{audioFollowsCamera ? "On" : "Off"}</strong>
			</label>
			<label class="explorer-environment-field">
				<span>Effect volume</span>
				<input
					max="1"
					min="0"
					step="0.05"
					type="range"
					value={effectVolume}
					oninput={(event) =>
						updateEffectVolume(
							Number((event.currentTarget as HTMLInputElement).value),
						)}
				/>
			</label>
			<label class="explorer-environment-field">
				<span>Ambient volume</span>
				<input
					max="1"
					min="0"
					step="0.05"
					type="range"
					value={ambientVolume}
					oninput={(event) =>
						updateAmbientVolume(
							Number((event.currentTarget as HTMLInputElement).value),
						)}
				/>
			</label>
			<label class="explorer-toggle">
				<input
					checked={envCellRenderMode === "portal"}
					type="checkbox"
					onchange={(event) =>
						updateEnvCellRenderMode(
							(event.currentTarget as HTMLInputElement).checked
								? "portal"
								: "flat",
						)}
				/>
				<span>Portal rendering</span>
				<strong>{envCellRenderMode === "portal" ? "On" : "Off"}</strong>
			</label>
		</fieldset>
	{/if}
	<fieldset
		class="explorer-section explorer-environment-controls"
		disabled={!runtimeReady}
	>
		<legend>Render quality</legend>
		<label class="explorer-toggle">
			<input
				checked={ambientOcclusion.enabled}
				type="checkbox"
				onchange={handleAmbientOcclusionChange}
			/>
			<span>Near-field ambient occlusion</span>
			<strong>{ambientOcclusion.enabled ? "On" : "Off"}</strong>
		</label>
		<label class="explorer-environment-field">
			<span
				>AO strength ({ambientOcclusion.parameters.intensity.toFixed(2)})</span
			>
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
			<span
				>AO radius ({ambientOcclusion.parameters.sampleRadius.toFixed(2)})</span
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
			<span>AO bias ({ambientOcclusion.parameters.bias.toFixed(2)})</span>
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
		<label class="explorer-environment-field">
			<span>Texture filtering</span>
			<select
				class="explorer-control explorer-control--select"
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
		<p>
			Device maximum:
			{maximumTextureAnisotropy === null
				? "detecting"
				: maximumTextureAnisotropy > 1
					? `${maximumTextureAnisotropy}x`
					: "linear only"}
		</p>
	</fieldset>
</div>
