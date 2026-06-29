import { getFreeCameraAxes } from "../camera/free-camera";
import type { FreeCameraState } from "../camera/free-camera";
import type {
	RuntimeCameraResidency,
	RuntimeSceneInterest,
} from "../runtime/client-runtime";
import { deriveOutdoorCameraLandblockResidency } from "../runtime/static-placement";
import type { BrowserSpawnFormState } from "./runtime-spawn-form";

const DEFAULT_CAMERA_SPAWN_DISTANCE_METERS = 1;

export interface BrowserSpawnCameraPlacementInput {
	/** Current browser camera pose in runtime render-local coordinates. */
	readonly camera: Pick<
		FreeCameraState,
		"pitchRadians" | "position" | "yawRadians"
	>;
	/** Current runtime camera residence used to choose outdoor versus env-cell spawn residence. */
	readonly currentCameraResidency: RuntimeCameraResidency;
	/** Current scene interest, used as the outdoor render anchor for landblock-local conversion. */
	readonly sceneInterest: RuntimeSceneInterest;
	/** Existing form state to preserve non-placement spawn fields. */
	readonly form: BrowserSpawnFormState;
	/** Distance ahead of the camera in runtime world units. */
	readonly distanceMeters?: number;
}

export function placeBrowserSpawnFormInFrontOfCamera(
	input: BrowserSpawnCameraPlacementInput,
): BrowserSpawnFormState | null {
	const forward = getFreeCameraAxes(input.camera).forward;
	const distance = input.distanceMeters ?? DEFAULT_CAMERA_SPAWN_DISTANCE_METERS;
	const origin = [
		input.camera.position[0] + forward[0] * distance,
		input.camera.position[1] + forward[1] * distance,
		input.camera.position[2] + forward[2] * distance,
	] as const;
	const baseForm = applyRenderLocalPointToSpawnOrigin(input.form, origin, {
		yawRadians: input.camera.yawRadians,
	});

	if (input.currentCameraResidency.kind === "env-cell") {
		return {
			...baseForm,
			envCellId: formatHex32(input.currentCameraResidency.envCellId),
			landblockId: formatHex32(input.currentCameraResidency.landblockId),
			residenceMode: "env-cell",
		};
	}

	if (input.sceneInterest.kind !== "outdoor-anchor") {
		return null;
	}

	const outdoorPlacement = deriveOutdoorCameraLandblockResidency({
		anchorLandblockId: input.sceneInterest.anchorLandblockId,
		cameraPosition: origin,
	});
	if (outdoorPlacement === null) {
		return null;
	}

	return {
		...applyRenderLocalPointToSpawnOrigin(
			baseForm,
			outdoorPlacement.localCameraPosition,
		),
		landblockId: formatHex32(outdoorPlacement.landblockId),
		residenceMode: "outdoor",
	};
}

function applyRenderLocalPointToSpawnOrigin(
	form: BrowserSpawnFormState,
	point: readonly [number, number, number],
	options: { readonly yawRadians?: number } = {},
): BrowserSpawnFormState {
	return {
		...form,
		originX: formatSpawnCoordinate(point[0]),
		originY: formatSpawnCoordinate(-point[2]),
		originZ: formatSpawnCoordinate(point[1]),
		yawDegrees:
			options.yawRadians === undefined
				? form.yawDegrees
				: formatSpawnCoordinate(radiansToDegrees(options.yawRadians)),
	};
}

function radiansToDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
}

function formatSpawnCoordinate(value: number): string {
	if (Object.is(value, -0)) {
		return "0";
	}
	return Number.isInteger(value)
		? value.toString()
		: value.toFixed(3).replace(/\.?0+$/, "");
}

function formatHex32(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}
