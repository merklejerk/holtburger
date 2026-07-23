import type { LandblockId } from "../lib/game/game-types";
import {
	createLandblockWorldOrigin,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../lib/game/landblocks";
import { Vec3 } from "../lib/game/math/types";
import { createCameraRotationRadians } from "../lib/game/math/camera-orientation";
import { GameRuntime } from "../lib/game/runtime/game-runtime";
import type { SceneInterestRevision } from "../lib/game/runtime/scene-availability";
import type { SceneAvailabilityEvent } from "../lib/game/runtime/scene-availability";
import type { Camera } from "../lib/game/runtime/types";
import type { LoDConfig } from "../lib/game/runtime/types";
import type { SceneResidency } from "../lib/game/scene";
import {
	FreeFlyCameraController,
	type FreeFlyCameraPose,
	type FreeFlyCameraState,
} from "./free-fly-camera-controller";

const CAMERA_FAR = 2_000;
// Legacy used a 60-degree vertical FOV. Keeping it preserves both perceived movement and framing.
const CAMERA_FOV_DEGREES = 60;
const CAMERA_NEAR = 0.5;
const OUTDOOR_FOCUS_CLEARANCE = 48;
const OUTDOOR_FOCUS_OFFSET = 48;

type InteriorResidency = SceneResidency & {
	readonly envCellId: NonNullable<SceneResidency["envCellId"]>;
};

type PendingFocus =
	| {
			readonly kind: "interior";
			readonly residency: InteriorResidency;
			readonly revision: SceneInterestRevision;
	  }
	| {
			readonly kind: "outdoor";
			readonly landblockId: LandblockId;
			readonly revision: SceneInterestRevision;
	  };

/** Explorer-visible summary of automatic camera placement state. */
export type ExplorerCameraFocusStatus =
	| "No camera focus requested."
	| "Loading outdoor terrain for initial camera placement."
	| "Waiting for environment-cell topology for initial camera placement."
	| "Environment-cell loading is not available in this Explorer build."
	| "Initial camera placement applied."
	| "Initial camera placement cancelled by manual control."
	| `Initial camera placement failed: ${string}`;

/**
 * Explorer policy connecting user-requested scene interest to its free-fly camera.
 *
 * Runtime supplies authoritative residency, surface, and availability facts. This coordinator
 * alone chooses initial poses, cancels them for manual input, and supplies camera framing.
 */
export class ExplorerCameraCoordinator {
	readonly #runtime: GameRuntime;
	readonly #controller: FreeFlyCameraController;
	readonly #onStatus: (status: ExplorerCameraFocusStatus) => void;
	readonly #unsubscribeAvailability: () => void;
	#pending: PendingFocus | null = null;

	constructor(
		runtime: GameRuntime,
		controller: FreeFlyCameraController,
		onStatus: (status: ExplorerCameraFocusStatus) => void,
	) {
		this.#runtime = runtime;
		this.#controller = controller;
		this.#onStatus = onStatus;
		this.#unsubscribeAvailability = runtime.subscribeSceneAvailability(
			(event) => {
				this.#handleSceneAvailability(event);
			},
		);
	}

	/** Request content around a frontend-selected location and begin the matching focus flow. */
	requestSceneInterest(residency: SceneResidency, lod: LoDConfig): void {
		const receipt = this.#runtime.updateSceneInterest({
			anchorLandblockId: residency.landblockId,
			lod,
		});
		const pending: PendingFocus =
			residency.envCellId === null
				? {
						kind: "outdoor",
						landblockId: residency.landblockId,
						revision: receipt.revision,
					}
				: {
						kind: "interior",
						residency: { ...residency, envCellId: residency.envCellId },
						revision: receipt.revision,
					};
		this.#pending = pending;
		if (pending.kind === "outdoor") {
			this.#onStatus("Loading outdoor terrain for initial camera placement.");
			this.#tryFocusOutdoor(pending);
			return;
		}
		this.#onStatus(
			"Environment-cell loading is not available in this Explorer build.",
		);
	}

	/** Submit controller updates with runtime-resolved residence; manual input cancels pending focus. */
	handleCameraState(state: FreeFlyCameraState): void {
		if (state.hasManualControl && this.#pending !== null) {
			this.#pending = null;
			this.#onStatus("Initial camera placement cancelled by manual control.");
		}
		const residency = this.#runtime.queryWorldPointResidency(state.position);
		if (!residency) return;
		this.#runtime.setPrimaryCamera(createCamera(residency, state));
	}

	dispose(): void {
		this.#unsubscribeAvailability();
		this.#pending = null;
	}

	#handleSceneAvailability(event: SceneAvailabilityEvent): void {
		const pending = this.#pending;
		if (!pending || event.revision !== pending.revision) return;
		if (event.kind === "outdoor-terrain-source-available") {
			if (
				pending.kind === "outdoor" &&
				event.landblockId === pending.landblockId
			)
				this.#tryFocusOutdoor(pending);
			return;
		}
		if (event.kind === "env-cell-topology-available") {
			if (
				pending.kind === "interior" &&
				event.residency.envCellId === pending.residency.envCellId
			) {
				this.#tryFocusInterior(pending);
			}
			return;
		}
		if (event.residency.landblockId === pendingLandblockId(pending)) {
			this.#pending = null;
			this.#onStatus(`Initial camera placement failed: ${event.message}`);
		}
	}

	#tryFocusOutdoor(
		pending: Extract<PendingFocus, { readonly kind: "outdoor" }>,
	): void {
		if (this.#pending !== pending) return;
		const origin = createLandblockWorldOrigin(pending.landblockId);
		const center = new Vec3(
			origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
			0,
			origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		);
		const position = new Vec3(
			center.x + OUTDOOR_FOCUS_OFFSET,
			0,
			center.z + OUTDOOR_FOCUS_OFFSET,
		);
		const surface = this.#runtime.queryOutdoorTerrainSurface(position);
		if (!surface || surface.landblockId !== pending.landblockId) return;
		const centerSurface = this.#runtime.queryOutdoorTerrainSurface(center);
		position.y = surface.height + OUTDOOR_FOCUS_CLEARANCE;
		center.y = centerSurface?.height ?? surface.height;
		this.#applyAutomaticPose(createLookAtPose(position, center));
	}

	#tryFocusInterior(
		pending: Extract<PendingFocus, { readonly kind: "interior" }>,
	): void {
		if (this.#pending !== pending) return;
		const bounds = this.#runtime.queryEnvCellBounds(pending.residency);
		if (!bounds) return;
		this.#applyAutomaticPose({
			pitchRadians: 0,
			position: new Vec3(
				(bounds.min.x + bounds.max.x) * 0.5,
				(bounds.min.y + bounds.max.y) * 0.5,
				(bounds.min.z + bounds.max.z) * 0.5,
			),
			yawRadians: 0,
		});
	}

	#applyAutomaticPose(pose: FreeFlyCameraPose): void {
		this.#pending = null;
		this.#controller.setAutomaticPose(pose);
		this.#onStatus("Initial camera placement applied.");
	}
}

function createCamera(
	residency: SceneResidency,
	state: FreeFlyCameraState,
): Camera {
	return {
		far: CAMERA_FAR,
		fov: CAMERA_FOV_DEGREES,
		near: CAMERA_NEAR,
		placement: {
			...residency,
			position: state.position,
			rotation: createCameraRotationRadians(
				state.yawRadians,
				state.pitchRadians,
			),
		},
	};
}

function createLookAtPose(position: Vec3, target: Vec3): FreeFlyCameraPose {
	const lookX = target.x - position.x;
	const lookY = target.y - position.y;
	const lookZ = target.z - position.z;
	const length = Math.hypot(lookX, lookY, lookZ);
	if (length === 0)
		throw new Error("Automatic camera focus target matches its position.");
	return {
		pitchRadians: Math.asin(lookY / length),
		position,
		yawRadians: Math.atan2(lookX, -lookZ),
	};
}

function pendingLandblockId(pending: PendingFocus): LandblockId {
	return pending.kind === "outdoor"
		? pending.landblockId
		: pending.residency.landblockId;
}
