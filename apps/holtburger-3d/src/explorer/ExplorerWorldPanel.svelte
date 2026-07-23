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
	}

	let { runtimeReady, requestSceneInterest, cameraFocusStatus }: Props =
		$props();

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

	const usesUnavailableLayers = $derived(
		lod.buildingRadius !== null ||
			lod.explicitObjectRadius !== null ||
			lod.generatedObjectRadius !== null ||
			lod.envCellRadius !== null,
	);
	const requestStatus = $derived(
		cameraFocusStatus === "No camera focus requested."
			? interestStatus
			: `${interestStatus} ${cameraFocusStatus}`,
	);
</script>

<div class="explorer-world-panel">
	<form class="explorer-world-form" onsubmit={submitInterest}>
		<fieldset disabled={!runtimeReady}>
			<legend>Scene interest</legend>
			<label>
				<span>Target landblock/cell</span>
				<input
					autocomplete="off"
					bind:value={interestInput}
					placeholder="da55 or da550123"
					spellcheck="false"
				/>
			</label>
			<p class:invalid={parsedInterest === null}>
				{parsedInterest?.label ?? "Enter four or eight hexadecimal digits."}
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
				{#if usesUnavailableLayers}
					<p class="explorer-lod-warning">
						Only terrain has a typed source capability today. Enabling another
						layer will produce an explicit runtime availability failure.
					</p>
				{/if}
			</div>
			<button type="submit" disabled={parsedInterest === null}>
				Request content and focus
			</button>
			<p>{requestStatus}</p>
		</fieldset>
	</form>
</div>
