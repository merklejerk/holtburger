import type { LandblockId } from "../lib/game/game-types";
import { stableVector3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import { createCameraRotationRadians } from "../lib/game/math/camera-orientation";
import { GameRuntime } from "../lib/game/runtime/game-runtime";
import type { SceneInterestRevision } from "../lib/game/runtime/scene-availability";
import type { SceneAvailabilityEvent } from "../lib/game/runtime/scene-availability";
import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
import type { Camera } from "../lib/game/runtime/types";
import type { LoDConfig } from "../lib/game/runtime/types";
import type { SceneResidency } from "../lib/game/scene";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";
import {
	FreeFlyCameraController,
	type FreeFlyCameraPose,
	type FreeFlyCameraState,
} from "./free-fly-camera-controller";
import {
	resolveExplorerPointResidency,
	resolveExplicitExplorerEnvCell,
	type ExplorerResidencyResolution,
} from "./explorer-residency";
import type { ExplorerCameraLocation } from "./explorer-camera-location";
import { resolveExplorerOutdoorFocusPose } from "./explorer-camera-framing";

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
	| "Environment-cell topology is unavailable for the requested scene interest."
	| "Initial camera placement applied."
	| "Initial camera placement cancelled by manual control."
	| "Camera position is outside canonical world bounds."
	| `Camera residency is ambiguous across EnvCells: ${string}.`
	| `Initial camera placement is outside selected EnvCell ${string}.`
	| `Initial camera placement failed: ${string}`;

/** Post-tick camera reconciliation consumed before attempting the matching render. */
export interface ExplorerCameraResidencySync {
	/** Exact pose and point-resolution result exposed by the Explorer HUD. */
	readonly location: ExplorerCameraLocation;
	/** Whether the runtime camera now owns a scope present in the current scene topology. */
	readonly renderable: boolean;
}

/**
 * Explorer policy connecting user-requested scene interest to its free-fly camera.
 *
 * Runtime supplies authoritative residency, surface, and availability facts. This coordinator
 * alone chooses initial poses, cancels them for manual input, and supplies camera framing.
 */
export class ExplorerCameraCoordinator {
	readonly #runtime: GameRuntime;
	/** Explorer default: the free camera carries the ears, which is what a viewer expects. */
	#audioFollowsCamera = true;
	readonly #controller: FreeFlyCameraController;
	readonly #onStatus: (status: ExplorerCameraFocusStatus) => void;
	readonly #unsubscribeAvailability: () => void;
	#pending: PendingFocus | null = null;
	#lastResidency: SceneResidency | null = null;
	/** Last unresolved point issue already surfaced, preventing per-frame status churn. */
	#lastResolutionIssue: ExplorerCameraFocusStatus | null = null;

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
		if (lod.envCellRadius === null) {
			this.#finishRejectedInteriorResolution(
				pending,
				resolveExplicitExplorerEnvCell(
					pending.residency,
					"topology-unavailable",
				),
			);
			return;
		}
		this.#onStatus(
			"Waiting for environment-cell topology for initial camera placement.",
		);
		this.#tryFocusInterior(pending, false);
	}

	/** Apply input-event policy without deriving residency from a potentially changing scene. */
	handleCameraState(state: FreeFlyCameraState): void {
		if (state.hasManualControl && this.#pending !== null) {
			this.#pending = null;
			this.#onStatus("Initial camera placement cancelled by manual control.");
		}
	}

	/** Re-resolve the controller pose after runtime mutations and update the render camera once. */
	syncCameraResidency(): ExplorerCameraResidencySync {
		const state = this.#controller.snapshotState();
		const resolution = resolveExplorerPointResidency(
			this.#runtime.queryWorldPointResidencyCandidates(state.position),
		);
		const location = { position: state.position, residency: resolution };
		if (resolution.kind === "resolved") {
			this.#lastResolutionIssue = null;
			this.#lastResidency = resolution.residency;
			this.#applyCamera(createCamera(resolution.residency, state));
			return { location, renderable: true };
		}
		if (resolution.kind === "ambiguous") {
			this.#reportResolutionIssue(
				`Camera residency is ambiguous across EnvCells: ${resolution.candidates
					.map(({ envCellId }) => envCellId)
					.join(", ")}.`,
			);
		} else if (resolution.kind === "outside") {
			this.#reportResolutionIssue(
				"Camera position is outside canonical world bounds.",
			);
		}
		const lastResidency = this.#lastResidency;
		if (
			lastResidency !== null &&
			lastResidency.envCellId !== null &&
			resolution.kind === "ambiguous" &&
			resolution.candidates.some(
				(candidate) =>
					candidate.envCellId === lastResidency.envCellId &&
					candidate.landblockId === lastResidency.landblockId,
			)
		) {
			this.#applyCamera(createCamera(lastResidency, state));
			return { location, renderable: true };
		}
		return { location, renderable: false };
	}

	/**
	 * Choose whether the audio listener rides the explorer's free camera.
	 *
	 * Explorer-local policy on purpose. The runtime owns the spatial maths but not the question of
	 * where the ears belong, and a free-fly camera is not obviously the right answer: a game client
	 * would put them on the player instead. Off leaves the listener wherever it last was, which is
	 * the scene origin until something moves it.
	 */
	setAudioFollowsCamera(follows: boolean): void {
		this.#audioFollowsCamera = follows;
	}

	#applyCamera(camera: Camera): void {
		this.#runtime.setPrimaryCamera(camera);
		if (!this.#audioFollowsCamera) return;
		const { position, rotation } = camera.placement;
		this.#runtime.setAudioListener({
			// The free-fly controller works in canonical scene coordinates: this is the same value
			// handed to `queryWorldPointResidencyCandidates` to resolve which landblock and EnvCell
			// the camera occupies, so it is stable-frame by construction.
			position: stableVector3([position.x, position.y, position.z]),
			rotation,
		});
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
				event.landblockId === pending.residency.landblockId
			) {
				this.#tryFocusInterior(pending, true);
			}
			return;
		}
		if (
			event.residency.landblockId !== pendingLandblockId(pending) ||
			event.layer !== pendingLayer(pending)
		) {
			return;
		}
		this.#pending = null;
		if (event.kind === "scene-content-unavailable") {
			this.#onStatus(
				pending.kind === "interior"
					? "Environment-cell topology is unavailable for the requested scene interest."
					: `Initial camera placement failed: No terrain content is available for ${pending.landblockId}.`,
			);
		} else {
			this.#pending = null;
			this.#onStatus(`Initial camera placement failed: ${event.message}`);
		}
	}

	#tryFocusOutdoor(
		pending: Extract<PendingFocus, { readonly kind: "outdoor" }>,
	): void {
		if (this.#pending !== pending) return;
		const pose = resolveExplorerOutdoorFocusPose(
			this.#runtime,
			pending.landblockId,
		);
		if (!pose) return;
		this.#applyAutomaticPose(pose);
	}

	#tryFocusInterior(
		pending: Extract<PendingFocus, { readonly kind: "interior" }>,
		topologyComplete: boolean,
	): void {
		if (this.#pending !== pending) return;
		const bounds = this.#runtime.queryEnvCellBounds(pending.residency);
		if (!bounds) {
			if (
				topologyComplete ||
				this.#runtime.hasEnvCellTopology(pending.residency.landblockId)
			) {
				this.#finishRejectedInteriorResolution(
					pending,
					resolveExplicitExplorerEnvCell(pending.residency, "outside"),
				);
			}
			return;
		}
		const position = new Vec3(
			(bounds.min.x + bounds.max.x) * 0.5,
			(bounds.min.y + bounds.max.y) * 0.5,
			(bounds.min.z + bounds.max.z) * 0.5,
		);
		if (
			this.#runtime.queryEnvCellPointContainment(
				pending.residency,
				position,
			) !== true
		) {
			this.#finishRejectedInteriorResolution(
				pending,
				resolveExplicitExplorerEnvCell(pending.residency, "outside"),
			);
			return;
		}
		const resolution = resolveExplicitExplorerEnvCell(
			pending.residency,
			"contained",
		);
		if (resolution.kind !== "resolved") {
			throw new Error("Contained explicit EnvCell did not resolve.");
		}
		this.#lastResidency = resolution.residency;
		this.#applyAutomaticPose({
			pitchRadians: 0,
			position,
			yawRadians: 0,
		});
	}

	#finishRejectedInteriorResolution(
		pending: Extract<PendingFocus, { readonly kind: "interior" }>,
		resolution: ExplorerResidencyResolution,
	): void {
		this.#pending = null;
		if (resolution.kind === "topology-unavailable") {
			this.#onStatus(
				"Environment-cell topology is unavailable for the requested scene interest.",
			);
			return;
		}
		if (resolution.kind === "outside") {
			this.#onStatus(
				`Initial camera placement is outside selected EnvCell ${pending.residency.envCellId}.`,
			);
			return;
		}
		throw new Error("Rejected explicit EnvCell unexpectedly resolved.");
	}

	#applyAutomaticPose(pose: FreeFlyCameraPose): void {
		this.#pending = null;
		this.#controller.setAutomaticPose(pose);
		this.#onStatus("Initial camera placement applied.");
	}

	#reportResolutionIssue(issue: ExplorerCameraFocusStatus): void {
		if (this.#lastResolutionIssue === issue) return;
		this.#lastResolutionIssue = issue;
		this.#onStatus(issue);
	}
}

function createCamera(
	residency: SceneResidency,
	state: FreeFlyCameraState,
): Camera {
	return {
		...FRONTEND_TUNING.explorer.camera.framing,
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

function pendingLandblockId(pending: PendingFocus): LandblockId {
	return pending.kind === "outdoor"
		? pending.landblockId
		: pending.residency.landblockId;
}

function pendingLayer(pending: PendingFocus): LandblockLayerKind {
	return pending.kind === "outdoor"
		? LandblockLayerKind.Terrain
		: LandblockLayerKind.EnvCells;
}
