import {
	evaluateHostPhysicalCameraPath,
	type HostPhysicalCameraPath,
	type GroundedCharacterEventOutcome,
	type PhysicalCameraGroundState,
	type PhysicalCameraMode,
	type PhysicalCameraPlacement,
	type PhysicalCameraTickStatus,
	type PhysicalCameraSceneResidency,
	validateHostPhysicalCameraPath,
} from "../lib/game/motion/host-physical-camera-path";
import type {
	GroundedCharacterDrive,
	GroundedCharacterEdge,
} from "./grounded-character-input";
import type { EnvCellId } from "../lib/game/game-types";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";

/**
 * Named host-resolved body profile plus body-owned collision exclusions.
 *
 * Solver physics is host-resolved from `holtburger-core`'s profile builders — the frontend names
 * what it wants and its app-policy knobs only, so no retail solver constant is mirrored here
 * (contact-slide plan, host-resolved body profiles addendum). The union mirrors the host's
 * tagged enum: edge protection exists only on the grounded profile.
 */
type PhysicalBodyProfileRequest = {
	/** Optional collision domains ignored by this body. */
	readonly collisionExclusions: readonly "entirely-water-barrier"[];
} & (
	| {
			readonly profile: "retail-player-grounded";
			/** Policy for retaining support near finite authored edges. */
			readonly edgeProtection: "none" | "creature";
	  }
	| { readonly profile: "physical-fly-viewer" }
);

type PhysicalCameraSpeedEnvelope =
	| {
			/** Apply requested speed immediately. */
			readonly kind: "instant";
	  }
	| {
			/** Linearly ramp a held nonzero request from an initial fraction to full speed. */
			readonly kind: "linear-ramp";
			/** Seconds of uninterrupted movement input required to reach full speed. */
			readonly accelerationSeconds: number;
			/** Fraction of requested speed applied when movement begins. */
			readonly initialSpeedMultiplier: number;
	  };

interface CharacterMotionCapabilities {
	/** Base forward speed selected by the walking gait. */
	readonly baseWalkForwardSpeed: number;
	/** Base forward speed selected by the running gait. */
	readonly baseRunForwardSpeed: number;
	/** Actor-specific run-rate scalar applied by the shared resolver. */
	readonly runRateScalar: number;
	/** Full-charge jump apex before retail's minimum-height floor. */
	readonly fullChargeJumpHeight: number;
}

/** Explorer-owned numeric capabilities for its synthetic character controller. */
function explorerCharacterCapabilities(): CharacterMotionCapabilities {
	return FRONTEND_TUNING.explorer.camera.controls.groundedCharacterCapabilities;
}

type PhysicalCameraControl =
	| {
			/** Host-accelerated collision-aware flight. */
			readonly kind: "physical-fly";
			readonly speedEnvelope: PhysicalCameraSpeedEnvelope;
	  }
	| {
			/** Semantic character control resolved before generic body actuation. */
			readonly kind: "grounded-character";
			readonly capabilities: CharacterMotionCapabilities;
	  };

/** Builds one controller contract without coupling capability facts to body geometry. */
function physicalCameraControl(
	mode: PhysicalCameraMode,
): PhysicalCameraControl {
	return mode === "physical-fly"
		? { kind: "physical-fly", speedEnvelope: physicalFlyCameraSpeedEnvelope() }
		: {
				kind: "grounded-character",
				capabilities: explorerCharacterCapabilities(),
			};
}

/** Explorer translation feel applied by the host before generic physical-body solving. */
function physicalFlyCameraSpeedEnvelope(): PhysicalCameraSpeedEnvelope {
	return {
		kind: "linear-ramp",
		accelerationSeconds:
			FRONTEND_TUNING.explorer.camera.controls.keyboardAccelerationSeconds,
		initialSpeedMultiplier:
			FRONTEND_TUNING.explorer.camera.controls.keyboardInitialSpeedMultiplier,
	};
}

/** Explorer product policy for its camera bodies: named profiles plus app-policy knobs. */
function physicalCameraBody(
	mode: PhysicalCameraMode,
): PhysicalBodyProfileRequest {
	if (mode === "physical-fly") {
		return {
			profile: "physical-fly-viewer",
			// Retail exempts viewer bodies from its whole-landblock ocean restriction.
			collisionExclusions: ["entirely-water-barrier"],
		};
	}
	return {
		profile: "retail-player-grounded",
		// Creature edge protection is Explorer UX policy: the walking camera holds at precipices.
		edgeProtection: "creature",
		collisionExclusions: [],
	};
}

/** Injectable Tauri boundary for one host-solved camera session. */
export interface PhysicalCameraTransport {
	invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
	listenMotion(
		event: string,
		handler: (path: HostPhysicalCameraPath) => void,
	): Promise<() => void>;
	listenFailure(
		event: string,
		handler: (failure: HostPhysicalCameraFailure) => void,
	): Promise<() => void>;
	now(): number;
}

/** Terminal host failure scoped to one exact camera ownership generation. */
export interface HostPhysicalCameraFailure {
	readonly session: number;
	readonly message: string;
}

/** Explorer-visible diagnostics for the current host session. */
export interface PhysicalCameraStatus {
	readonly mode: PhysicalCameraMode | null;
	readonly tick: PhysicalCameraTickStatus | "awaiting-first-path";
	readonly cellId: EnvCellId | null;
	readonly groundState: PhysicalCameraGroundState;
	readonly constraintCount: number;
	readonly droppedPaths: number;
	readonly sceneResidency: PhysicalCameraSceneResidency | null;
	readonly substeps: number;
	readonly contactPasses: number;
	readonly solveDurationMs: number;
}

/** Owns transport ordering and bounded fixed-tick playback for one physical-camera handoff. */
export class PhysicalCameraSession {
	readonly #transport: PhysicalCameraTransport;
	#unlisten: (() => void) | null = null;
	#session: number | null = null;
	#preRegistrationPath: HostPhysicalCameraPath | null = null;
	#preRegistrationFailure: HostPhysicalCameraFailure | null = null;
	#terminalError: Error | null = null;
	#activePath: HostPhysicalCameraPath | null = null;
	#pendingPath: HostPhysicalCameraPath | null = null;
	#activeStartedAt = 0;
	#latestPath: HostPhysicalCameraPath | null = null;
	#highestSequence = -1;
	#droppedPaths = 0;
	#intentSequence = 0;
	#inputRevision = 0;
	#movementEpoch = 0;
	#movementActive = false;
	#lastIntent: PhysicalCameraInput | null = null;
	#lastGroundedInput: GroundedCameraInput | null = null;
	#characterEventOutcomes: GroundedCharacterEventOutcome[] = [];
	#mode: PhysicalCameraMode | null = null;
	#jumpChargeDurationMs: number | null = null;
	#worldDisplacementTotal: [number, number, number] = [0, 0, 0];

	constructor(transport: PhysicalCameraTransport) {
		this.#transport = transport;
	}

	/** Registers the listener before starting the host so the first path cannot be missed. */
	async start(
		placement: PhysicalCameraPlacement,
		viewDirection: readonly [number, number, number],
		mode: PhysicalCameraMode,
	): Promise<void> {
		if (this.#unlisten !== null) return;
		const unlistenMotion = await this.#transport.listenMotion(
			"host://physical-camera-motion",
			(path) => this.#receivePath(path),
		);
		let unlistenFailure: (() => void) | null = null;
		try {
			unlistenFailure = await this.#transport.listenFailure(
				"host://physical-camera-failure",
				(failure) => this.#receiveFailure(failure),
			);
			this.#unlisten = () => {
				unlistenMotion();
				unlistenFailure?.();
			};
			const result = await this.#transport.invoke("start_physical_camera", {
				registration: {
					body: physicalCameraBody(mode),
					control: physicalCameraControl(mode),
					residency: placement.residency,
					scenePosition: [
						placement.position.x,
						placement.position.y,
						placement.position.z,
					],
					viewDirection,
				},
			});
			const receipt = physicalCameraStartReceipt(result, mode);
			this.#session = receipt.session;
			this.#mode = mode;
			this.#jumpChargeDurationMs = receipt.jumpChargeDurationMs;
			const pending = this.#preRegistrationPath;
			this.#preRegistrationPath = null;
			if (pending?.session === receipt.session) this.#acceptPath(pending);
			const failure = this.#preRegistrationFailure;
			this.#preRegistrationFailure = null;
			if (failure?.session === receipt.session) this.#acceptFailure(failure);
		} catch (error) {
			this.#unlisten?.();
			if (this.#unlisten === null) unlistenMotion();
			this.#unlisten = null;
			throw error;
		}
	}

	/** Stops exactly this generation and releases its event listener. */
	async stop(): Promise<void> {
		const unlisten = this.#unlisten;
		const session = this.#session;
		if (unlisten === null) return;
		try {
			if (session !== null) {
				await this.#transport.invoke("stop_physical_camera", { session });
			}
		} finally {
			unlisten();
			this.#reset();
		}
	}

	get running(): boolean {
		return this.#unlisten !== null && this.#session !== null;
	}

	/** Host-supplied charge timing used by both the power bar and normalized release extent. */
	groundedJumpChargeDurationMs(): number {
		if (this.#mode !== "grounded-walk" || this.#jumpChargeDurationMs === null) {
			throw new Error(
				"Grounded jump charge timing requires a grounded session.",
			);
		}
		return this.#jumpChargeDurationMs;
	}

	/** Sends one concrete movement/view intent only when either owned input changes. */
	async setIntent(
		worldVelocity: readonly [number, number, number],
		viewDirection: readonly [number, number, number],
	): Promise<void> {
		const session = this.#session;
		if (session === null) return;
		if (this.#mode !== "physical-fly") {
			throw new Error(
				"Concrete world velocity is valid only for physical fly.",
			);
		}
		const input = { viewDirection, worldVelocity };
		const movementActive = worldVelocity.some((component) => component !== 0);
		if (movementActive && !this.#movementActive) this.#movementEpoch += 1;
		this.#movementActive = movementActive;
		if (this.#lastIntent !== null && inputsEqual(input, this.#lastIntent))
			return;
		this.#lastIntent = input;
		const sequence = this.#intentSequence++;
		try {
			await this.#transport.invoke("set_physical_fly_camera_intent", {
				intent: {
					movementEpoch: this.#movementEpoch,
					session,
					sequence,
					viewDirection,
					worldDisplacementTotal: this.#worldDisplacementTotal,
					worldVelocity,
				},
			});
		} catch (error) {
			// Permit an identical input event to retry, but do not roll back over a newer intent.
			if (this.#lastIntent !== null && inputsEqual(this.#lastIntent, input)) {
				this.#lastIntent = null;
			}
			throw error;
		}
	}

	/** Sends one coalescible semantic drive/view snapshot for grounded character control. */
	async setGroundedDrive(
		drive: GroundedCharacterDrive,
		viewDirection: readonly [number, number, number],
	): Promise<void> {
		const session = this.#session;
		if (session === null) return;
		if (this.#mode !== "grounded-walk") {
			throw new Error(
				"Semantic character drive is valid only for grounded walk.",
			);
		}
		const input = { drive, viewDirection };
		if (
			this.#lastGroundedInput !== null &&
			groundedInputsEqual(input, this.#lastGroundedInput)
		) {
			return;
		}
		this.#lastGroundedInput = input;
		const revision = this.#inputRevision++;
		try {
			await this.#transport.invoke("set_grounded_camera_drive", {
				intent: { drive, revision, session, viewDirection },
			});
		} catch (error) {
			if (
				this.#lastGroundedInput !== null &&
				groundedInputsEqual(this.#lastGroundedInput, input)
			) {
				this.#lastGroundedInput = null;
			}
			throw error;
		}
	}

	/** Queues one ordered jump/reset edge; fixed-tick semantic outcome arrives on the motion path. */
	async queueGroundedEvent(
		edge: GroundedCharacterEdge,
		viewDirection: readonly [number, number, number],
	): Promise<void> {
		const session = this.#session;
		if (session === null) return;
		if (this.#mode !== "grounded-walk") {
			throw new Error(
				"Character lifecycle edges are valid only for grounded walk.",
			);
		}
		const revision = this.#inputRevision++;
		const result = await this.#transport.invoke("queue_grounded_camera_event", {
			request: { ...edge, revision, session, viewDirection },
		});
		if (result !== "queued") {
			throw new Error(
				`Host rejected grounded character edge: ${String(result)}.`,
			);
		}
	}

	/** Queues one collision-solved displacement without replacing held velocity. */
	async addDisplacement(
		worldDisplacement: readonly [number, number, number],
		worldVelocity: readonly [number, number, number],
		viewDirection: readonly [number, number, number],
	): Promise<void> {
		this.#worldDisplacementTotal = this.#worldDisplacementTotal.map(
			(component, index) => component + worldDisplacement[index],
		) as [number, number, number];
		this.#lastIntent = null;
		await this.setIntent(worldVelocity, viewDirection);
	}

	placement(): PhysicalCameraPlacement | null {
		const now = this.#transport.now();
		this.#advancePlayback(now);
		if (this.#activePath === null) return null;
		return evaluateHostPhysicalCameraPath(
			this.#activePath,
			now - this.#activeStartedAt,
		);
	}

	status(): PhysicalCameraStatus {
		const latest = this.#latestPath;
		return {
			mode: latest?.mode ?? null,
			tick: latest?.status ?? "awaiting-first-path",
			cellId: latest?.legs.at(-1)?.end.residency.envCellId ?? null,
			groundState: latest?.groundState ?? "unknown",
			constraintCount: latest?.constraintCount ?? 0,
			droppedPaths: this.#droppedPaths,
			sceneResidency: latest?.sceneResidency ?? null,
			substeps: latest?.substeps ?? 0,
			contactPasses: latest?.contactPasses ?? 0,
			solveDurationMs: latest?.solveDurationMs ?? 0,
		};
	}

	/** Drains lifecycle results once so optimistic presentation cannot replay them. */
	takeCharacterEventOutcomes(): readonly GroundedCharacterEventOutcome[] {
		return this.#characterEventOutcomes.splice(0);
	}

	/** Drains one terminal host error so the owning UI can perform a deliberate handoff. */
	takeTerminalError(): Error | null {
		const error = this.#terminalError;
		this.#terminalError = null;
		return error;
	}

	#receiveFailure(failure: HostPhysicalCameraFailure): void {
		validatePhysicalCameraFailure(failure);
		if (this.#session === null) {
			this.#preRegistrationFailure = failure;
			return;
		}
		if (failure.session === this.#session) this.#acceptFailure(failure);
	}

	#acceptFailure(failure: HostPhysicalCameraFailure): void {
		this.#terminalError = new Error(
			`Physical camera host tick failed: ${failure.message}`,
		);
	}

	#receivePath(path: HostPhysicalCameraPath): void {
		if (this.#session === null) {
			this.#preRegistrationPath = path;
			return;
		}
		if (path.session !== this.#session) return;
		this.#acceptPath(path);
	}

	#acceptPath(path: HostPhysicalCameraPath): void {
		if (path.sequence <= this.#highestSequence) return;
		validateHostPhysicalCameraPath(path);
		const gap = path.sequence - this.#highestSequence - 1;
		this.#droppedPaths += gap;
		this.#highestSequence = path.sequence;
		this.#latestPath = path;
		this.#characterEventOutcomes.push(...path.characterEventOutcomes);
		const now = this.#transport.now();
		if (this.#activePath === null || gap > 0) {
			this.#activePath = path;
			this.#pendingPath = null;
			this.#activeStartedAt = now;
			return;
		}

		const activeEndsAt = this.#activeStartedAt + this.#activePath.durationMs;
		if (now >= activeEndsAt) {
			const pending = this.#pendingPath;
			if (pending === null) {
				// A late successor owns a fresh fixed-tick interval from its explicit initial point.
				this.#activePath = path;
				this.#activeStartedAt = now;
				return;
			}
			const pendingEndsAt = activeEndsAt + pending.durationMs;
			if (now >= pendingEndsAt) {
				// Both retained ticks are stale after suspension. Resume from the newest host point.
				this.#activePath = path;
				this.#pendingPath = null;
				this.#activeStartedAt = now;
				return;
			}
			this.#activePath = pending;
			this.#pendingPath = path;
			this.#activeStartedAt = activeEndsAt;
			return;
		}

		if (this.#pendingPath === null) {
			this.#pendingPath = path;
			return;
		}
		// More than one pending tick means the renderer stopped consuming. Resume from an explicit
		// host point rather than accumulating input latency or fabricating a bridge.
		this.#activePath = path;
		this.#pendingPath = null;
		this.#activeStartedAt = now;
	}

	#advancePlayback(now: number): void {
		const active = this.#activePath;
		if (active === null || now - this.#activeStartedAt < active.durationMs)
			return;
		const pending = this.#pendingPath;
		if (pending === null) return;
		this.#activeStartedAt += active.durationMs;
		this.#activePath = pending;
		this.#pendingPath = null;
	}

	#reset(): void {
		this.#unlisten = null;
		this.#session = null;
		this.#preRegistrationPath = null;
		this.#preRegistrationFailure = null;
		this.#terminalError = null;
		this.#activePath = null;
		this.#pendingPath = null;
		this.#latestPath = null;
		this.#highestSequence = -1;
		this.#droppedPaths = 0;
		this.#intentSequence = 0;
		this.#inputRevision = 0;
		this.#movementEpoch = 0;
		this.#movementActive = false;
		this.#lastIntent = null;
		this.#lastGroundedInput = null;
		this.#characterEventOutcomes = [];
		this.#mode = null;
		this.#jumpChargeDurationMs = null;
		this.#worldDisplacementTotal = [0, 0, 0];
	}
}

function validatePhysicalCameraFailure(
	failure: HostPhysicalCameraFailure,
): void {
	if (
		!Number.isSafeInteger(failure.session) ||
		failure.session <= 0 ||
		typeof failure.message !== "string" ||
		failure.message.length === 0
	) {
		throw new Error("Host returned an invalid physical-camera failure event.");
	}
}

interface PhysicalCameraInput {
	readonly viewDirection: readonly [number, number, number];
	readonly worldVelocity: readonly [number, number, number];
}

interface GroundedCameraInput {
	readonly drive: GroundedCharacterDrive;
	readonly viewDirection: readonly [number, number, number];
}

function groundedInputsEqual(
	left: GroundedCameraInput,
	right: GroundedCameraInput,
): boolean {
	return (
		left.drive.gait === right.drive.gait &&
		left.drive.lateral === right.drive.lateral &&
		left.drive.longitudinal === right.drive.longitudinal &&
		left.drive.turn === right.drive.turn &&
		vectorsEqual(left.viewDirection, right.viewDirection)
	);
}

function inputsEqual(
	left: PhysicalCameraInput,
	right: PhysicalCameraInput,
): boolean {
	return (
		vectorsEqual(left.worldVelocity, right.worldVelocity) &&
		vectorsEqual(left.viewDirection, right.viewDirection)
	);
}

function vectorsEqual(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	return left.every((component, index) => component === right[index]);
}

function physicalCameraStartReceipt(
	value: unknown,
	mode: PhysicalCameraMode,
): { readonly jumpChargeDurationMs: number | null; readonly session: number } {
	if (typeof value !== "object" || value === null) {
		throw new Error(
			"Host returned an invalid physical-camera registration receipt.",
		);
	}
	const receipt = value as Record<string, unknown>;
	if (
		typeof receipt.session !== "number" ||
		!Number.isSafeInteger(receipt.session) ||
		receipt.session <= 0
	) {
		throw new Error("Host returned an invalid physical-camera session id.");
	}
	const duration = receipt.jumpChargeDurationMs;
	if (mode === "grounded-walk") {
		if (
			typeof duration !== "number" ||
			!Number.isSafeInteger(duration) ||
			duration <= 0
		) {
			throw new Error(
				"Host returned an invalid grounded jump charge duration.",
			);
		}
		return { jumpChargeDurationMs: duration, session: receipt.session };
	}
	if (duration !== null) {
		throw new Error(
			"Physical-fly registration unexpectedly returned jump timing.",
		);
	}
	return { jumpChargeDurationMs: null, session: receipt.session };
}
