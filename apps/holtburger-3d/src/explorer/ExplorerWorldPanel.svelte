<script lang="ts">
	import type { SceneResidency } from "../lib/game/scene";
	import type { LoDConfig } from "../lib/game/runtime/types";
	import type { ExplorerCameraFocusStatus } from "./explorer-camera-coordinator";
	import {
		DEFAULT_EXPLORER_LOD_CONFIG,
		formatExplorerLodRadius,
		MAX_EXPLORER_LOD_RADIUS,
		MIN_EXPLORER_LOD_RADIUS,
		updateExplorerLodRadius,
		type ExplorerLodRadius,
	} from "./explorer-lod";
	import { parseResidenceInput } from "./world-input";
	import type { ExplorerEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import type { EnvCellRenderMode } from "../lib/game/renderer/renderer";

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
		/** Update Explorer's distance-fog presentation switch. */
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly envCellRenderMode: EnvCellRenderMode;
		readonly updateEnvCellRenderMode: (mode: EnvCellRenderMode) => void;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		cameraFocusStatus,
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
		distanceFogEnabled,
		updateDistanceFog,
		envCellRenderMode,
		updateEnvCellRenderMode,
	}: Props = $props();

	let interestInput = $state("0000");
	let interestStatus = $state("No scene interest requested.");
	let lod = $state<LoDConfig>({ ...DEFAULT_EXPLORER_LOD_CONFIG });

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
						max={MAX_EXPLORER_LOD_RADIUS}
						min={MIN_EXPLORER_LOD_RADIUS}
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
</div>
