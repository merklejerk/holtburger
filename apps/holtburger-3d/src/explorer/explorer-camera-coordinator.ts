import type { LandblockOwnerId } from "../lib/game/game-types";
import { sceneVec3, sceneVector3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import { createCameraRotationRadians } from "../lib/game/math/camera-orientation";
import { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
import type { HostCameraPlacement } from "../lib/game/motion/host-placed-path";
import type { SceneInterestRevision } from "../lib/game/runtime/scene-availability";
import type { SceneAvailabilityEvent } from "../lib/game/runtime/scene-availability";
import type {
	SceneActivationReceipt,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";
import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
import type { SceneInterestRequest } from "../lib/game/runtime/scene-interest";
import type { Camera } from "../lib/game/runtime/types";
import type { ProjectionClearanceRevision } from "../lib/game/camera/projection-clearance";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import type { SceneResidency } from "../lib/game/scene";
import type { PortalTransitionFrame } from "../lib/game/renderer/renderer";
import {
	PortalTransitionController,
	type PortalRevealReceipt,
	type PortalTransitionState,
} from "../lib/client/portal-transition-controller";
import type {
	ResolvedSceneInterestTarget,
	SceneInterestTarget,
} from "../lib/game/runtime/scene-target";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";
import {
	ExplorerCameraInputController,
	type FreeFlyCameraPose,
	type FreeFlyCameraState,
} from "./explorer-camera-input-controller";
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

/** Pending outdoor follow request awaiting shared profile-aware scene-interest resolution. */
export interface PendingExplorerFollowSceneInterest {
	readonly radii: SceneInterestRadii;
	readonly residency: SceneResidency;
	readonly target: SceneInterestTarget;
}

type PendingFocus =
	| {
			readonly kind: "interior";
			readonly residency: InteriorResidency;
			readonly revision: SceneInterestRevision;
	  }
	| {
			readonly kind: "outdoor";
			readonly landblockId: LandblockOwnerId;
			readonly revision: SceneInterestRevision;
	  };

/** Explorer-visible summary of automatic camera placement state. */
export type ExplorerCameraFocusStatus =
	| "No camera focus requested."
	| "Loading outdoor terrain for initial camera placement."
	| "Waiting for environment-cell topology for initial camera placement."
	| "Loading dungeon environment-cell topology for initial camera placement."
	| "Environment-cell topology is unavailable for the requested scene interest."
	| "Initial camera placement applied."
	| "Initial camera placement cancelled by manual control."
	| "Camera position is outside canonical world bounds."
	| "Camera position is outside active dungeon topology."
	| "Waiting for first host camera placement."
	| `Camera residency is ambiguous across EnvCells: ${string}.`
	| `Camera residency follows host placement ${string}.`
	| `Host-selected EnvCell ${string} is unavailable for camera rendering.`
	| `Initial camera placement is outside selected EnvCell ${string}.`
	| "Releasing possession before scene-interest change."
	| `Scene-interest change failed: ${string}`
	| `Scene target unavailable: ${string}`
	| `Initial camera placement failed: ${string}`;

/** Post-tick camera reconciliation consumed before attempting the matching render. */
export interface ExplorerCameraResidencySync {
	/** Exact pose and point-resolution result exposed by the Explorer HUD. */
	readonly location: ExplorerCameraLocation | null;
	/** Whether the runtime camera now owns a scope present in the current scene topology. */
	readonly renderable: boolean;
}

/** The current scene-interest target and the radii outdoor follow mode reuses. */
export interface ExplorerSceneInterestSnapshot {
	readonly target: ResolvedSceneInterestTarget;
	readonly radii: SceneInterestRadii;
	readonly residency: SceneResidency;
}

/** One valid phase of the Explorer-owned scene installation transaction. */
type ExplorerSceneActivation =
	| { readonly kind: "requesting"; readonly generation: number }
	| {
			readonly kind: "installing";
			readonly receipt: SceneActivationReceipt;
			readonly ready: boolean;
	  };

/**
 * Explorer policy connecting user-requested scene interest to its free-fly camera.
 *
 * Runtime supplies authoritative residency, surface, and availability facts. This coordinator
 * alone chooses initial poses, cancels them for manual input, and supplies camera framing.
 */
export class ExplorerCameraCoordinator {
	readonly #runtime: GamePresentationRuntime;
	/** Explorer default: the free camera carries the ears, which is what a viewer expects. */
	#audioFollowsCamera = true;
	readonly #controller: ExplorerCameraInputController;
	readonly #onStatus: (status: ExplorerCameraFocusStatus) => void;
	readonly #unsubscribeAvailability: () => void;
	#pending: PendingFocus | null = null;
	/**
	 * The one scene-interest snapshot of record, or null before anything has been requested.
	 *
	 * Every writer of runtime scene interest goes through this coordinator, so this stays the
	 * single answer to "which target is active". Follow mode reuses its radii rather than carrying
	 * a second copy that can disagree with the focus flow mid-request.
	 */
	#sceneInterestSnapshot: ExplorerSceneInterestSnapshot | null = null;
	#pendingFollowSceneInterest: PendingExplorerFollowSceneInterest | null = null;
	/** The source-neutral replacement currently being requested or installed, if any. */
	#sceneActivation: ExplorerSceneActivation | null = null;
	readonly #portalTransition = new PortalTransitionController();
	#hasRenderedFrame = false;
	#lastResidency: SceneResidency | null = null;
	/** Exact position/residency most recently applied to the runtime camera. */
	#presentedPlacement: HostCameraPlacement | null = null;
	/** Last host placement announced to the Explorer status panel. */
	#lastReportedHostResidency: SceneResidency | null = null;
	/** One host-owned residency carried across the physical-to-free-fly authority handoff. */
	#pendingFreeFlyResidency: SceneResidency | null = null;
	/** Last unresolved point issue already surfaced, preventing per-frame status churn. */
	#lastResolutionIssue: ExplorerCameraFocusStatus | null = null;

	constructor(
		runtime: GamePresentationRuntime,
		controller: ExplorerCameraInputController,
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

	/** Request content for a frontend-selected target and begin the matching focus flow. */
	requestSceneInterest(
		request: SceneInterestRequest,
		generation: number,
	): Promise<void> {
		const { radii, target } = request;
		this.#pendingFollowSceneInterest = null;
		this.#cancelSceneActivation();
		const residency = focusResidency(target);
		this.#sceneInterestSnapshot = {
			radii: { ...radii },
			residency: { ...residency },
			target,
		};
		this.#pending = null;
		this.#sceneActivation = { kind: "requesting", generation };
		this.#portalTransition.begin(generation, this.#hasRenderedFrame);
		this.#runtime.playPortalTransitionSound?.("enter");
		this.#onStatus(
			residency.envCellId === null
				? "Loading outdoor terrain for initial camera placement."
				: target.kind === "dungeon"
					? "Loading dungeon environment-cell topology for initial camera placement."
					: "Waiting for environment-cell topology for initial camera placement.",
		);
		return this.#runtime
			.activateScene({
				generation,
				target: request,
			})
			.then((receipt) => {
				const activation = this.#sceneActivation;
				if (
					activation?.kind !== "requesting" ||
					activation.generation !== generation
				)
					return;
				this.#sceneActivation = {
					kind: "installing",
					receipt,
					ready: false,
				};
				this.#pending = pendingFocusFor(residency, receipt.revision);
				this.pollSceneActivation();
			})
			.catch((error: unknown) => {
				const activation = this.#sceneActivation;
				if (
					activation?.kind !== "requesting" ||
					activation.generation !== generation
				)
					return;
				this.#sceneActivation = null;
				this.#pending = null;
				this.#portalTransition.reset();
				this.#onStatus(
					`Initial camera placement failed: ${errorMessage(error)}`,
				);
			});
	}

	/** Current renderer input for the shared portal presentation, if a replacement is active. */
	portalTransitionFrame(): PortalTransitionFrame | undefined {
		const state = this.#portalTransition.state();
		return state === null ? undefined : portalTransitionFrame(state);
	}

	/** Advance the shared presentation state and return a one-shot reveal edge when emitted. */
	advancePortalTransition(
		nowMs: number,
		destinationFrameRendered: boolean,
	): PortalRevealReceipt | null {
		if (this.#portalTransition.state() === null) return null;
		const update = this.#portalTransition.tick({
			nowMs,
			activationReady: this.activationReady(),
			destinationFrameRendered,
		});
		if (update.audio !== undefined) {
			this.#runtime.playPortalTransitionSound?.(update.audio);
		}
		if (destinationFrameRendered) this.#hasRenderedFrame = true;
		return update.reveal;
	}

	/** Record a normal finished frame so a later replacement may retain it as outgoing content. */
	markRenderedFrame(): void {
		this.#hasRenderedFrame = true;
	}

	/** Poll the exact installation receipt from the Explorer frame loop. */
	pollSceneActivation(): SceneActivationStatus | null {
		const activation = this.#sceneActivation;
		if (activation?.kind !== "installing") return null;
		const receipt = activation.receipt;
		const status = this.#runtime.sceneActivationStatus(receipt);
		if (status.kind === "failed") {
			console.error({
				diagnostic: status.diagnostic,
				generation: receipt.generation,
				kind: "explorer-scene-activation-failed",
				revision: receipt.revision,
			});
			this.#sceneActivation = null;
			this.#pending = null;
			this.#portalTransition.reset();
			this.#onStatus(`Initial camera placement failed: ${status.diagnostic}`);
			return status;
		}
		if (status.kind !== "ready") return status;
		if (!activation.ready) {
			this.#sceneActivation = { ...activation, ready: true };
			const pending = this.#pending;
			if (pending?.kind === "outdoor") this.#tryFocusOutdoor(pending);
			if (pending?.kind === "interior") {
				if (
					this.#sceneInterestSnapshot?.radii.envCellRadius === null &&
					this.#sceneInterestSnapshot.target.kind !== "dungeon"
				) {
					this.#finishRejectedInteriorResolution(
						pending,
						resolveExplicitExplorerEnvCell(
							pending.residency,
							"topology-unavailable",
						),
					);
				} else this.#tryFocusInterior(pending, true);
			}
		}
		return status;
	}

	/** Whether an activation is still withholding the Explorer camera/input handoff. */
	activationPending(): boolean {
		return this.#sceneActivation !== null;
	}

	/** Whether the destination products are installed and may produce the first destination frame. */
	activationReady(): boolean {
		return (
			this.#sceneActivation?.kind === "installing" &&
			this.#sceneActivation.ready
		);
	}

	/** Complete the mode-specific handoff after the first destination frame. */
	completeSceneActivation(): void {
		const activation = this.#sceneActivation;
		if (activation?.kind === "installing")
			this.#runtime.completeSceneActivation(activation.receipt.generation);
		this.#sceneActivation = null;
		this.#portalTransition.reset();
	}

	/** Cancel one superseded activation without touching the continuous follow policy. */
	#cancelSceneActivation(): void {
		const activation = this.#sceneActivation;
		if (activation?.kind === "installing")
			this.#runtime.completeSceneActivation(activation.receipt.generation);
		this.#sceneActivation = null;
	}

	/**
	 * Reuse the established radii when the camera reaches a new outdoor residency.
	 *
	 * Follow mode's whole policy. No focus flow runs: the camera is already there, so placing it
	 * would fight the viewer. Returns whether interest moved, which is what callers need to keep
	 * their own interest-bearing systems in step.
	 *
	 * Declines while an automatic placement is pending, because until it applies the camera is
	 * still at the location being left. Treating that as a crossing would move interest back
	 * to it and supersede the revision the pending placement is waiting on, so the requested
	 * landblock would load and then immediately unload again.
	 */
	prepareFollowCameraResidency(
		resolution: ExplorerResidencyResolution,
	): PendingExplorerFollowSceneInterest | null {
		if (resolution.kind !== "resolved") return null;
		const residency = resolution.residency;
		const sceneInterest = this.#sceneInterestSnapshot;
		if (
			sceneInterest === null ||
			this.activationPending() ||
			this.#pending !== null ||
			sceneInterest.target.kind === "dungeon" ||
			sceneInterest.residency.landblockId === residency.landblockId ||
			this.#pendingFollowSceneInterest?.residency.landblockId ===
				residency.landblockId
		) {
			return null;
		}
		const pending: PendingExplorerFollowSceneInterest = {
			radii: sceneInterest.radii,
			residency,
			target: {
				kind: "outdoor",
				landblockId: residency.landblockId,
			},
		};
		this.#pendingFollowSceneInterest = pending;
		return pending;
	}

	/** Apply a current, profile-resolved follow request after the camera crossed an outdoor owner. */
	applyFollowCameraResidency(
		pending: PendingExplorerFollowSceneInterest,
		request: SceneInterestRequest,
	): boolean {
		if (this.#pendingFollowSceneInterest !== pending) return false;
		this.#pendingFollowSceneInterest = null;
		if (
			request.target.kind !== "outdoor" ||
			request.target.requested.kind !== "outdoor" ||
			request.target.requested.landblockId !== pending.residency.landblockId
		) {
			return false;
		}
		this.#sceneInterestSnapshot = {
			radii: { ...pending.radii },
			residency: { ...pending.residency },
			target: request.target,
		};
		this.#runtime.updateSceneInterest(request);
		return true;
	}

	/** Drop one failed follow resolution so a later crossing can retry explicitly. */
	rejectFollowCameraResidency(
		pending: PendingExplorerFollowSceneInterest,
	): void {
		if (this.#pendingFollowSceneInterest === pending)
			this.#pendingFollowSceneInterest = null;
	}

	/** Copy the scene-interest snapshot for diagnostics. */
	sceneInterest(): ExplorerSceneInterestSnapshot | null {
		const sceneInterest = this.#sceneInterestSnapshot;
		return sceneInterest === null
			? null
			: {
					radii: { ...sceneInterest.radii },
					residency: { ...sceneInterest.residency },
					target: sceneInterest.target,
				};
	}

	/** Apply input-event policy without deriving residency from a potentially changing scene. */
	handleCameraState(state: FreeFlyCameraState): void {
		if (state.hasManualControl && this.#pending !== null) {
			this.#pending = null;
			this.#onStatus("Initial camera placement cancelled by manual control.");
		}
	}

	/** Re-resolve a frontend-owned free-fly pose and update the render camera once. */
	syncFreeFlyCamera(
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync {
		this.#lastReportedHostResidency = null;
		const state = this.#controller.snapshotState();
		const handoffResidency = this.#pendingFreeFlyResidency;
		this.#pendingFreeFlyResidency = null;
		if (handoffResidency !== null) {
			return this.#syncKnownResidency(
				state,
				state.position,
				handoffResidency,
				"physical-handoff",
				projection,
			);
		}
		const resolution = resolveExplorerPointResidency(
			this.#runtime.queryWorldPointResidencyCandidates(state.position),
		);
		if (this.#sceneInterestSnapshot?.target.kind === "dungeon") {
			if (
				resolution.kind === "resolved" &&
				resolution.residency.envCellId !== null &&
				resolution.residency.landblockId ===
					this.#sceneInterestSnapshot.residency.landblockId
			) {
				this.#lastResolutionIssue = null;
				this.#lastResidency = resolution.residency;
				this.#applyCamera(
					createCamera(resolution.residency, state, projection),
					projection,
				);
				return {
					location: { position: state.position, residency: resolution },
					renderable: true,
				};
			}
			this.#reportResolutionIssue(
				"Camera position is outside active dungeon topology.",
			);
			return {
				location: { position: state.position, residency: resolution },
				renderable: false,
			};
		}
		const location = { position: state.position, residency: resolution };
		if (resolution.kind === "resolved") {
			this.#lastResolutionIssue = null;
			this.#lastResidency = resolution.residency;
			this.#applyCamera(
				createCamera(resolution.residency, state, projection),
				projection,
			);
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
			this.#applyCamera(
				createCamera(lastResidency, state, projection),
				projection,
			);
			return { location, renderable: true };
		}
		return { location, renderable: false };
	}

	/**
	 * Apply one host-authored boom presentation with residency and path-aligned look orientation.
	 */
	syncBoomCamera(
		placement: HostCameraPlacement,
		yawRadians: number,
		pitchRadians: number,
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync {
		this.#lastReportedHostResidency = null;
		const state = {
			...this.#controller.snapshotState(),
			pitchRadians,
			position: placement.position,
			yawRadians,
		};
		return this.#syncKnownResidency(
			state,
			placement.position,
			placement.residency,
			"host-boom-camera",
			projection,
		);
	}

	/** Apply one host-owned physical placement without re-deriving its portal residency. */
	syncPhysicalCamera(
		placement: HostCameraPlacement | null,
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync {
		if (placement === null) {
			this.#reportResolutionIssue("Waiting for first host camera placement.");
			return { location: null, renderable: false };
		}
		const state = this.#controller.snapshotState();
		const position = placement.position;
		return this.#syncKnownResidency(
			state,
			position,
			placement.residency,
			"host-physical-camera",
			projection,
		);
	}

	/** Seed exactly the first frontend-owned frame from the last host placement. */
	seedFreeFlyResidency(residency: SceneResidency): void {
		this.#pendingFreeFlyResidency = { ...residency };
	}

	/** Copy the exact placement currently applied to the renderer for an authority handoff. */
	presentedPlacement(): HostCameraPlacement | null {
		const placement = this.#presentedPlacement;
		return placement === null
			? null
			: {
					position: sceneVec3(placement.position.clone()),
					residency: { ...placement.residency },
				};
	}

	#syncKnownResidency(
		state: FreeFlyCameraState,
		position: Vec3,
		residency: SceneResidency,
		source: "host-boom-camera" | "host-physical-camera" | "physical-handoff",
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync {
		if (
			residency.envCellId !== null &&
			!this.#runtime.hasEnvCellScope(residency)
		) {
			this.#reportResolutionIssue(
				`Host-selected EnvCell ${residency.envCellId} is unavailable for camera rendering.`,
			);
			return {
				location: {
					position,
					residency: {
						kind: "topology-unavailable",
						landblockId: residency.landblockId,
					},
				},
				renderable: false,
			};
		}
		const resolution: ExplorerResidencyResolution = {
			kind: "resolved",
			residency,
			source,
		};
		const resolvedAnIssue = this.#lastResolutionIssue !== null;
		this.#lastResolutionIssue = null;
		this.#lastResidency = residency;
		this.#applyCamera(
			createCamera(residency, { ...state, position }, projection),
			projection,
		);
		const hostPlacementChanged =
			source === "host-physical-camera" &&
			!sameResidency(this.#lastReportedHostResidency, residency);
		if (source === "host-physical-camera") {
			this.#lastReportedHostResidency = residency;
		}
		if (resolvedAnIssue || hostPlacementChanged) {
			this.#onStatus(
				`Camera residency follows host placement ${formatResidency(residency)}.`,
			);
		}
		return { location: { position, residency: resolution }, renderable: true };
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

	#applyCamera(camera: Camera, projection: ProjectionClearanceRevision): void {
		this.#runtime.setPrimaryView({ camera, extent: projection.extent });
		this.#presentedPlacement = {
			position: sceneVec3(camera.placement.position.clone()),
			residency: {
				envCellId: camera.placement.envCellId,
				landblockId: camera.placement.landblockId,
			},
		};
		if (!this.#audioFollowsCamera) return;
		const { position, rotation, envCellId } = camera.placement;
		this.#runtime.setAudioListener({
			// Both frontend and host presentation positions enter this method in canonical scene
			// coordinates, so the retained listener position is scene-frame by construction.
			position: sceneVector3([position.x, position.y, position.z]),
			rotation,
			envCellId,
		});
	}

	dispose(): void {
		this.#unsubscribeAvailability();
		this.#cancelSceneActivation();
		this.#sceneInterestSnapshot = null;
		this.#pendingFollowSceneInterest = null;
		this.#pending = null;
		this.#lastReportedHostResidency = null;
		this.#pendingFreeFlyResidency = null;
		this.#presentedPlacement = null;
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
		if (this.#pending !== pending || !this.activationReady()) return;
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
		if (this.#pending !== pending || !this.activationReady()) return;
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
	projection: ProjectionClearanceRevision,
): Camera {
	return {
		far: FRONTEND_TUNING.explorer.camera.framing.far,
		fov: projection.fov,
		near: projection.near,
		placement: {
			...residency,
			// The controller works in canonical scene coordinates; the same value resolves
			// residency through `queryWorldPointResidencyCandidates`.
			position: sceneVec3(state.position),
			rotation: createCameraRotationRadians(
				state.yawRadians,
				state.pitchRadians,
			),
		},
	};
}

function pendingLandblockId(pending: PendingFocus): LandblockOwnerId {
	return pending.kind === "outdoor"
		? pending.landblockId
		: pending.residency.landblockId;
}

function pendingFocusFor(
	residency: SceneResidency,
	revision: SceneInterestRevision,
): PendingFocus {
	return residency.envCellId === null
		? {
				kind: "outdoor",
				landblockId: residency.landblockId,
				revision,
			}
		: {
				kind: "interior",
				residency: { ...residency, envCellId: residency.envCellId },
				revision,
			};
}

function pendingLayer(pending: PendingFocus): LandblockLayerKind {
	return pending.kind === "outdoor"
		? LandblockLayerKind.Terrain
		: LandblockLayerKind.EnvCells;
}

function formatResidency(residency: SceneResidency): string {
	return residency.envCellId ?? `outdoor ${residency.landblockId}`;
}

function focusResidency(target: ResolvedSceneInterestTarget): SceneResidency {
	const requested = target.requested;
	if (target.kind === "dungeon") {
		return {
			envCellId:
				requested.kind === "env-cell"
					? requested.envCellId
					: (`${requested.landblockId.slice(0, 6)}0100` as NonNullable<
							SceneResidency["envCellId"]
						>),
			landblockId: requested.landblockId,
		};
	}
	return requested.kind === "env-cell"
		? {
				envCellId: requested.envCellId,
				landblockId: requested.landblockId,
			}
		: { envCellId: null, landblockId: requested.landblockId };
}

function sameResidency(
	left: SceneResidency | null,
	right: SceneResidency,
): boolean {
	return (
		left !== null &&
		left.landblockId === right.landblockId &&
		left.envCellId === right.envCellId
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function portalTransitionFrame(
	state: PortalTransitionState,
): PortalTransitionFrame {
	return {
		generation: state.generation,
		outgoingAvailable:
			state.kind !== "revealed-awaiting-handoff" && state.outgoingCaptured,
		phase: state.kind,
		progress:
			state.kind === "exiting"
				? state.progress
				: state.kind === "revealed-awaiting-handoff"
					? 1
					: 0,
	};
}
