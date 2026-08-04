<script lang="ts">
	import type { SceneResidency } from "../lib/game/scene";
	import type { LoDConfig } from "../lib/game/runtime/types";
	import { FRONTEND_TUNING } from "../lib/frontend-tuning";
	import type { ExplorerCameraFocusStatus } from "./explorer-camera-coordinator";
	import {
		formatExplorerLodRadius,
		updateExplorerLodRadius,
		type ExplorerLodRadius,
	} from "./explorer-lod";
	import { parseResidenceInput } from "./world-input";
	import type { ExplorerEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import type { EnvCellRenderMode } from "../lib/game/renderer/renderer";
	import {
		textureFilteringPolicyLabel,
		type TextureFilteringPolicy,
	} from "../lib/game/renderer/texture-filtering-policy";

	interface Props {
		/** Whether Explorer has a runtime available to accept world operations. */
		readonly runtimeReady: boolean;
		/** Request frontend-owned scene content and automatic Explorer camera placement. */
		readonly requestSceneInterest: (
			residency: SceneResidency,
			lod: LoDConfig,
		) => void;
		/** Current automatic camera-placement lifecycle state. */
		readonly cameraFocusStatus: ExplorerCameraFocusStatus;
		readonly environmentSelection: ExplorerEnvironmentSelection;
		readonly dayGroupNames: readonly string[];
		readonly updateEnvironment: (
			selection: ExplorerEnvironmentSelection,
		) => void;
		/** Explorer-local switch controlling distance-fog presentation. */
		readonly distanceFogEnabled: boolean;
		readonly viewerLightEnabled: boolean;
		readonly clockFollowing: boolean;
		/** Update Explorer's distance-fog presentation switch. */
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly updateViewerLight: (enabled: boolean) => void;
		readonly updateClockFollowing: (enabled: boolean) => void;
		readonly envCellRenderMode: EnvCellRenderMode;
		readonly updateEnvCellRenderMode: (mode: EnvCellRenderMode) => void;
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
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
		distanceFogEnabled,
		viewerLightEnabled,
		clockFollowing,
		updateDistanceFog,
		updateViewerLight,
		updateClockFollowing,
		envCellRenderMode,
		updateEnvCellRenderMode,
		textureFiltering,
		textureFilteringOptions,
		maximumTextureAnisotropy,
		updateTextureFiltering,
	}: Props = $props();

	let interestInput = $state("0000");
	let interestStatus = $state("No scene interest requested.");
	let lod = $state<LoDConfig>({ ...FRONTEND_TUNING.explorer.lod.defaultRadii });

	const parsedInterest = $derived(parseResidenceInput(interestInput));

	function submitInterest(event: SubmitEvent): void {
		event.preventDefault();
		if (!runtimeReady || !parsedInterest) return;
		requestSceneInterest(parsedInterest.residency, lod);
		interestStatus = `Requested around ${parsedInterest.residency.landblockId}.`;
	}

	function updateRadius(kind: ExplorerLodRadius, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		lod = updateExplorerLodRadius(
			lod,
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

	function handleViewerLightChange(event: Event): void {
		updateViewerLight((event.currentTarget as HTMLInputElement).checked);
	}

	function handleClockFollowingChange(event: Event): void {
		updateClockFollowing((event.currentTarget as HTMLInputElement).checked);
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
			<div
				class="explorer-lod-controls"
				aria-label="Scene interest level of detail"
			>
				<p class="ac-section-label">Outdoor LoD</p>
				<label class="explorer-lod-control">
					<span>Terrain</span>
					<strong>{formatExplorerLodRadius(lod.terrainRadius)}</strong>
					<input
						max={FRONTEND_TUNING.explorer.lod.maximumRadius}
						min={FRONTEND_TUNING.explorer.lod.minimumRadius}
						step="1"
						type="range"
						value={lod.terrainRadius}
						oninput={(event) => updateRadius("terrain", event)}
					/>
				</label>
				<label class="explorer-lod-control">
					<span>Buildings</span>
					<strong>{formatExplorerLodRadius(lod.buildingRadius)}</strong>
					<input
						max={lod.terrainRadius}
						min="-1"
						step="1"
						type="range"
						value={lod.buildingRadius ?? -1}
						oninput={(event) => updateRadius("buildings", event)}
					/>
				</label>
				<label class="explorer-lod-control">
					<span>Explicit objects</span>
					<strong>{formatExplorerLodRadius(lod.explicitObjectRadius)}</strong>
					<input
						disabled={lod.buildingRadius === null}
						max={lod.buildingRadius ?? -1}
						min="-1"
						step="1"
						type="range"
						value={lod.explicitObjectRadius ?? -1}
						oninput={(event) => updateRadius("explicitObjects", event)}
					/>
				</label>
				<label class="explorer-lod-control">
					<span>Generated scenery</span>
					<strong>{formatExplorerLodRadius(lod.generatedObjectRadius)}</strong>
					<input
						disabled={lod.buildingRadius === null}
						max={lod.buildingRadius ?? -1}
						min="-1"
						step="1"
						type="range"
						value={lod.generatedObjectRadius ?? -1}
						oninput={(event) => updateRadius("generatedObjects", event)}
					/>
				</label>
				<label class="explorer-lod-control">
					<span>Env cells</span>
					<strong>{formatExplorerLodRadius(lod.envCellRadius)}</strong>
					<input
						max={lod.terrainRadius}
						min="-1"
						step="1"
						type="range"
						value={lod.envCellRadius ?? -1}
						oninput={(event) => updateRadius("envCells", event)}
					/>
				</label>
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
					checked={clockFollowing}
					type="checkbox"
					onchange={handleClockFollowingChange}
				/>
				<span>Follow clock</span>
				<strong>{clockFollowing ? "On" : "Off"}</strong>
			</label>
			<label class="explorer-environment-field">
				<span>EnvCell renderer</span>
				<select
					class="explorer-control explorer-control--select"
					value={envCellRenderMode}
					onchange={(event) =>
						updateEnvCellRenderMode(
							(event.currentTarget as HTMLSelectElement)
								.value as EnvCellRenderMode,
						)}
				>
					<option value="flat">Flat inspection</option>
					<option value="portal">Portal rendering</option>
				</select>
			</label>
		</fieldset>
	{/if}
	<fieldset
		class="explorer-section explorer-environment-controls"
		disabled={!runtimeReady || maximumTextureAnisotropy === null}
	>
		<legend>Render quality</legend>
		<label class="explorer-environment-field">
			<span>Texture filtering</span>
			<select
				class="explorer-control explorer-control--select"
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
