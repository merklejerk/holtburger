<script lang="ts">
	import { onMount } from "svelte";
	import type { SceneResidency } from "../lib/game/scene";
	import type { SceneInterestTarget } from "../lib/game/runtime/scene-target";
	import type { SceneInterestRadii } from "../lib/game/runtime/types";
	import { EXPLORER_TUNING } from "./explorer-tuning";
	import type { ExplorerCameraFocusStatus } from "./explorer-camera-coordinator";
	import {
		formatResidencyRadius,
		updateExplorerResidencyRadius,
		type ExplorerRadiusKind,
	} from "./explorer-residency-radius";
	import { parseResidenceInput } from "./world-input";
	import type { ExplorerEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import type { PhysicalFlyStatus } from "./physical-fly-session";
	import type { ExplorerCameraMode } from "../lib/game/motion/host-physical-fly-path";
	import ToggleField from "../app/ToggleField.svelte";
	import ExplorerControlGroup from "./ExplorerControlGroup.svelte";

	interface Props {
		/** Whether Explorer has a runtime available to accept world operations. */
		readonly runtimeReady: boolean;
		/** Request frontend-owned scene content and automatic Explorer camera placement. */
		readonly requestSceneInterest: (
			target: SceneInterestTarget,
			radii: SceneInterestRadii,
		) => void;
		/** Current automatic camera-placement lifecycle state. */
		readonly cameraFocusStatus: ExplorerCameraFocusStatus;
		/** Formatted camera residency, or null before the first presented frame. */
		readonly cameraResidencyLabel: string | null;
		readonly cameraMode: ExplorerCameraMode;
		readonly cameraModePending: boolean;
		/** Bounded diagnostic read owned by this mounted panel. */
		readonly readPhysicalCameraStatus: () => PhysicalFlyStatus | null;
		readonly physicalCameraError: string | null;
		readonly updateCameraMode: (mode: ExplorerCameraMode) => void;
		readonly environmentSelection: ExplorerEnvironmentSelection;
		readonly dayGroupNames: readonly string[];
		readonly updateEnvironment: (
			selection: ExplorerEnvironmentSelection,
		) => void;
		/** Mirrors retail's `DisableMostWeatherEffects` player option, inverted. */
		readonly weatherEnabled: boolean;
		readonly clockFollowing: boolean;
		/** Follow mode: scene interest follows accepted outdoor residency crossings. */
		readonly interestFollowsCamera: boolean;
		readonly updateInterestFollowsCamera: (enabled: boolean) => void;
		/** Whether the audio listener rides the free camera; see the camera coordinator. */
		readonly audioFollowsCamera: boolean;
		/** Effect-category volume in [0, 1]; retail's other categories are not produced yet. */
		readonly effectVolume: number;
		readonly ambientVolume: number;
		readonly updateWeather: (enabled: boolean) => void;
		readonly updateClockFollowing: (enabled: boolean) => void;
		readonly updateAudioFollowsCamera: (enabled: boolean) => void;
		readonly updateEffectVolume: (volume: number) => void;
		readonly updateAmbientVolume: (volume: number) => void;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		cameraFocusStatus,
		cameraResidencyLabel,
		cameraMode,
		cameraModePending,
		readPhysicalCameraStatus,
		physicalCameraError,
		updateCameraMode,
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
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
		updateWeather,
		updateClockFollowing,
	}: Props = $props();
	let physicalCameraStatus = $state<PhysicalFlyStatus | null>(null);

	onMount(() => {
		const sample = (): void => {
			physicalCameraStatus = readPhysicalCameraStatus();
		};
		sample();
		const interval = window.setInterval(
			sample,
			EXPLORER_TUNING.diagnostics.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});

	let interestInput = $state("0000");
	let interestStatus = $state("No scene interest requested.");
	let radii = $state<SceneInterestRadii>({
		...EXPLORER_TUNING.residency.defaultRadii,
	});

	const parsedInterest = $derived(parseResidenceInput(interestInput));

	function submitInterest(event: SubmitEvent): void {
		event.preventDefault();
		if (!runtimeReady || !parsedInterest) return;
		requestSceneInterest(parsedInterest.target, radii);
		interestStatus = `Requested ${parsedInterest.label}.`;
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
	<p class="explorer-world-residency">
		<span>Camera cell</span>
		<strong>{cameraResidencyLabel ?? "—"}</strong>
	</p>
	<form class="explorer-world-form" onsubmit={submitInterest}>
		<ExplorerControlGroup
			title="Scene interest"
			initiallyOpen
			disabled={!runtimeReady}
		>
			<label class="ac-form-field">
				<span>Target landblock, cell, or coordinates</span>
				<input
					class="ac-control"
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
			<ToggleField
				checked={interestFollowsCamera}
				label="Interest follows camera"
				checkedLabel="On"
				uncheckedLabel="Off"
				onCheckedChange={updateInterestFollowsCamera}
			/>
			<div
				class="explorer-lod-controls"
				aria-label="Scene interest level of detail"
			>
				<p class="ac-section-label">Outdoor residency</p>
				<div class="explorer-lod-control">
					<label for="explorer-residency-terrain">Terrain</label>
					<strong>{formatResidencyRadius(radii.terrainRadius)}</strong>
					<input
						id="explorer-residency-terrain"
						max={EXPLORER_TUNING.residency.maximumRadius}
						min={EXPLORER_TUNING.residency.minimumRadius}
						step="1"
						type="range"
						value={radii.terrainRadius}
						oninput={(event) => updateRadius("terrain", event)}
					/>
				</div>
				<div class="explorer-lod-control">
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
				<div class="explorer-lod-control">
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
				<div class="explorer-lod-control">
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
				<div class="explorer-lod-control">
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
		</ExplorerControlGroup>
	</form>
	<ExplorerControlGroup
		title="Camera navigation"
		disabled={!runtimeReady || cameraModePending}
	>
		<label class="ac-form-field">
			<span>Position authority</span>
			<select
				class="ac-control ac-control--select"
				value={cameraMode}
				onchange={handleCameraModeChange}
			>
				<option value="free-fly">Frontend free fly</option>
				<option value="physical-fly">Host physical fly</option>
			</select>
		</label>
		<p>
			{cameraModePending
				? "Loading collision content and placing the physical camera."
				: cameraMode !== "free-fly"
					? `Host physical fly: ${physicalCameraStatus?.tick ?? "awaiting-first-path"}; collision ${physicalCameraStatus?.sceneResidency?.state ?? "unknown"}; cell ${physicalCameraStatus?.cellId ?? "outdoor"}; ${physicalCameraStatus?.groundState ?? "unknown"}; ${physicalCameraStatus?.constraintCount ?? 0} solve constraints; ${physicalCameraStatus?.solveDurationMs.toFixed(2) ?? "0.00"} ms; ${physicalCameraStatus?.substeps ?? 0} substeps; ${physicalCameraStatus?.contactPasses ?? 0} contact passes; ${physicalCameraStatus?.droppedPaths ?? 0} dropped paths.`
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
	</ExplorerControlGroup>
	{#if dayGroupNames.length > 0}
		<ExplorerControlGroup
			title="Regional environment"
			initiallyOpen
			disabled={!runtimeReady}
		>
			<label class="explorer-environment-field">
				<span>Day</span>
				<input
					class="ac-control"
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
					class="ac-control ac-control--select"
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
			<ToggleField
				checked={weatherEnabled}
				label="Weather"
				checkedLabel="On"
				uncheckedLabel="Off"
				onCheckedChange={updateWeather}
			/>
			<ToggleField
				checked={clockFollowing}
				label="Follow clock"
				checkedLabel="On"
				uncheckedLabel="Off"
				onCheckedChange={updateClockFollowing}
			/>
			<ToggleField
				checked={audioFollowsCamera}
				label="Audio follows camera"
				checkedLabel="On"
				uncheckedLabel="Off"
				onCheckedChange={updateAudioFollowsCamera}
			/>
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
		</ExplorerControlGroup>
	{/if}
</div>
