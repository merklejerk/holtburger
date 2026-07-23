<script lang="ts">
	import type { LandblockId } from "../lib/game/game-types";
	import { Vec3 } from "../lib/game/math/types";
	import type { SceneResidency } from "../lib/game/scene";
	import type { Camera } from "../lib/game/runtime/types";
	import { createCameraRotation, parseResidenceInput } from "./world-input";

	const CAMERA_FOV_DEGREES = 90;
	const CAMERA_NEAR = 0.5;
	const CAMERA_FAR = 2_000;

	interface Props {
		/** Whether Explorer has a runtime available to accept world operations. */
		readonly runtimeReady: boolean;
		/** Submit frontend-owned content interest independently of camera placement. */
		readonly requestSceneInterest: (
			anchorLandblockId: LandblockId,
			includeEnvCells: boolean,
		) => void;
		/** Query currently resident scene data at one canonical world-space point. */
		readonly queryWorldPointResidency: (
			point: Vec3,
		) => SceneResidency | null;
		/** Submit one fully resolved authoritative camera to the runtime. */
		readonly setPrimaryCamera: (camera: Camera) => void;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		queryWorldPointResidency,
		setPrimaryCamera,
	}: Props = $props();

	let interestInput = $state("0000");
	let cameraResidencyInput = $state("0000");
	let worldX = $state(96);
	let worldY = $state(100);
	let worldZ = $state(-96);
	let yawDegrees = $state(0);
	let pitchDegrees = $state(-45);
	let interestStatus = $state("No scene interest requested.");
	let cameraStatus = $state("No primary camera submitted.");

	const parsedInterest = $derived(parseResidenceInput(interestInput));
	const parsedCameraResidency = $derived(
		parseResidenceInput(cameraResidencyInput),
	);
	const cameraNumbersValid = $derived(
		[worldX, worldY, worldZ, yawDegrees, pitchDegrees].every(Number.isFinite),
	);

	function submitInterest(event: SubmitEvent): void {
		event.preventDefault();
		if (!runtimeReady || !parsedInterest) return;
		const residency = parsedInterest.residency;
		requestSceneInterest(residency.landblockId, residency.envCellId !== null);
		interestStatus = `Requested around ${residency.landblockId}.`;
	}

	function submitManualCamera(event: SubmitEvent): void {
		event.preventDefault();
		if (!runtimeReady || !parsedCameraResidency) return;
		applyCamera(parsedCameraResidency.residency, "manual residence");
	}

	function resolveAndApplyCamera(): void {
		if (!runtimeReady) return;
		const residency = queryWorldPointResidency(createWorldPoint());
		if (!residency) {
			cameraStatus = "Resident scene data could not resolve this point.";
			return;
		}
		cameraResidencyInput = residency.envCellId ?? residency.landblockId;
		applyCamera(residency, "scene query");
	}

	function applyCamera(residency: SceneResidency, source: string): void {
		setPrimaryCamera({
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			near: CAMERA_NEAR,
			placement: {
				...residency,
				position: createWorldPoint(),
				rotation: createCameraRotation(yawDegrees, pitchDegrees),
			},
		});
		cameraStatus = `Applied ${source}: ${formatResidency(residency)}.`;
	}

	function createWorldPoint(): Vec3 {
		return new Vec3(worldX, worldY, worldZ);
	}

	function formatResidency(residency: SceneResidency): string {
		return residency.envCellId ?? residency.landblockId;
	}
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
			<button type="submit" disabled={parsedInterest === null}>
				Request content
			</button>
			<p>{interestStatus}</p>
		</fieldset>
	</form>

	<form class="explorer-world-form" onsubmit={submitManualCamera}>
		<fieldset disabled={!runtimeReady}>
			<legend>Primary camera</legend>
			<label>
				<span>Resolved residence</span>
				<input
					autocomplete="off"
					bind:value={cameraResidencyInput}
					placeholder="da55ffff or da550123"
					spellcheck="false"
				/>
			</label>

			<div class="explorer-world-vector">
				<label>
					<span>World X</span>
					<input required type="number" step="any" bind:value={worldX} />
				</label>
				<label>
					<span>World Y</span>
					<input required type="number" step="any" bind:value={worldY} />
				</label>
				<label>
					<span>World Z</span>
					<input required type="number" step="any" bind:value={worldZ} />
				</label>
			</div>

			<div class="explorer-world-vector compact">
				<label>
					<span>Yaw °</span>
					<input required type="number" step="any" bind:value={yawDegrees} />
				</label>
				<label>
					<span>Pitch °</span>
					<input required type="number" step="any" bind:value={pitchDegrees} />
				</label>
			</div>

			<div class="explorer-world-actions">
				<button
					type="submit"
					disabled={parsedCameraResidency === null || !cameraNumbersValid}
				>
					Apply residence
				</button>
				<button
					type="button"
					disabled={!cameraNumbersValid}
					onclick={resolveAndApplyCamera}
				>
					Resolve point
				</button>
			</div>
			<p>{cameraStatus}</p>
		</fieldset>
	</form>
</div>
