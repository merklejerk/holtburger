import type { DynamicEntityWorldPlacement } from "../lib/game/runtime/dynamic-entity-feed";
import {
	MINIMUM_JUMP_POWER,
	type ClientCameraIdentity,
	type ClientPreciseJumpAimRequest,
	type ClientPreciseJumpProgress,
	type ClientPreciseJumpTransactionFeedback,
} from "./client-host-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";

export type ClientPreciseJumpRay = Omit<
	ClientPreciseJumpAimRequest,
	"sequence" | "power"
>;

export type ClientPreciseJumpState =
	| { readonly kind: "inactive" }
	| {
			readonly kind: "targeting";
			readonly evaluation: ClientPreciseJumpProgress | null;
	  }
	| {
			readonly kind: "commit-pending";
			readonly evaluation: ClientPreciseJumpProgress;
			readonly actionSequence: number;
	  };

/** Consumer-facing split between cold mode UI and the imperative presentation payload. */
export interface ClientPreciseJumpSnapshot {
	/** Cold mode discriminant consumed by input and markup. */
	readonly active: boolean;
	/** Latest accepted target forwarded directly to world presentation. */
	readonly marker: ClientPreciseJumpProgress | null;
	/** Source moved while the same chosen target/power remains launchable. */
	readonly refreshing: boolean;
}

/** Narrow monotonic scheduling seam for deterministic aim-cadence tests. */
export interface ClientPreciseJumpCadence {
	nowMilliseconds(): number;
	schedule(delayMilliseconds: number, callback: () => void): () => void;
}

const browserPreciseJumpCadence: ClientPreciseJumpCadence = {
	nowMilliseconds: () => performance.now(),
	schedule: (delayMilliseconds, callback) => {
		const timeout = globalThis.setTimeout(callback, delayMilliseconds);
		return () => globalThis.clearTimeout(timeout);
	},
};

interface SubmittedPreciseJumpAim {
	readonly camera: ClientCameraIdentity;
	readonly sequence: number;
}

/** Owns replaceable aim correlation and ordered commit/cancel edges for one client session. */
export class ClientPreciseJumpSession {
	readonly #lifecycle: ClientLifecycleSession;
	readonly #onError: (error: unknown) => void;
	readonly #cadence: ClientPreciseJumpCadence;
	/** Minimum delay between host aim submissions for this session. */
	readonly #aimEvaluationIntervalMs: number;
	readonly #listeners = new Set<
		(snapshot: ClientPreciseJumpSnapshot) => void
	>();
	readonly #unsubscribe: () => void;
	#state: ClientPreciseJumpState = { kind: "inactive" };
	#snapshot: ClientPreciseJumpSnapshot = {
		active: false,
		marker: null,
		refreshing: false,
	};
	#power: number = Math.max(
		MINIMUM_JUMP_POWER,
		Math.min(1, CLIENT_TUNING.preciseJump.initialPower),
	);
	#nextAimSequence = 1;
	#nextActionSequence = 1;
	#submissionPending = false;
	#lastRay: ClientPreciseJumpRay | null = null;
	#actorPose: DynamicEntityWorldPlacement["pose"] | null = null;
	#lastSubmissionMilliseconds: number | null = null;
	#submittedAim: SubmittedPreciseJumpAim | null = null;
	#pendingInput: {
		readonly ray: ClientPreciseJumpRay;
		readonly refresh: boolean;
	} | null = null;
	#cancelCadence: (() => void) | null = null;
	#destroyed = false;

	constructor(
		lifecycle: ClientLifecycleSession,
		onError: (error: unknown) => void = () => undefined,
		cadence: ClientPreciseJumpCadence = browserPreciseJumpCadence,
		aimEvaluationIntervalMs = CLIENT_TUNING.preciseJump.aimEvaluationIntervalMs,
	) {
		this.#lifecycle = lifecycle;
		this.#onError = onError;
		this.#cadence = cadence;
		this.#aimEvaluationIntervalMs = aimEvaluationIntervalMs;
		this.#unsubscribe = lifecycle.subscribe((event) => this.#receive(event));
	}

	state(): ClientPreciseJumpState {
		return this.#state;
	}

	/** Read the coherent cold-mode/presentation split without entering a reactive graph. */
	snapshot(): ClientPreciseJumpSnapshot {
		return this.#snapshot;
	}

	subscribe(
		listener: (snapshot: ClientPreciseJumpSnapshot) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	enter(): void {
		if (this.#destroyed || this.#state.kind !== "inactive") return;
		this.#lastRay = null;
		this.#actorPose = null;
		this.#lastSubmissionMilliseconds = null;
		this.#submittedAim = null;
		this.#pendingInput = null;
		this.#publish({ kind: "targeting", evaluation: null });
	}

	/** Replace the latest pointer sample without queueing pointer history. */
	aim(ray: ClientPreciseJumpRay): void {
		if (this.#state.kind !== "targeting" || this.#destroyed) return;
		if (this.#lastRay !== null && sameRay(this.#lastRay, ray)) return;
		this.#lastRay = ray;
		this.#pendingInput = { ray, refresh: false };
		this.#publish({ kind: "targeting", evaluation: null });
		this.#schedulePendingAim();
	}

	power(): number {
		return this.#power;
	}

	/** Power is explicit input; changing it queues a replacement even for an unchanged ray. */
	adjustPower(steps: number): void {
		this.#adjustPowerBy(steps * CLIENT_TUNING.preciseJump.powerStep);
	}

	/** Integrate held power input by elapsed time, independently of keyboard repeat rate. */
	adjustHeldPower(direction: -1 | 0 | 1, elapsedSeconds: number): void {
		if (elapsedSeconds <= 0) return;
		this.#adjustPowerBy(
			direction * elapsedSeconds * CLIENT_TUNING.preciseJump.heldPowerPerSecond,
		);
	}

	#adjustPowerBy(amount: number): void {
		this.setPower(this.#power + amount);
	}

	/** Direct bar input shares the legal range and replacement lifecycle with other controls. */
	setPower(value: number): void {
		if (this.#state.kind !== "targeting" || !Number.isFinite(value)) return;
		const power = Math.max(MINIMUM_JUMP_POWER, Math.min(1, value));
		if (power === this.#power) return;
		this.#power = power;
		this.#publish({ kind: "targeting", evaluation: null });
		if (this.#lastRay !== null) {
			this.#pendingInput = { ray: this.#lastRay, refresh: false };
			this.#schedulePendingAim();
		}
	}

	/** A resolved choice can launch while its collision prediction is pending or misses. */
	activate(): boolean {
		if (
			this.#state.kind !== "targeting" ||
			(this.#pendingInput !== null && !this.#pendingInput.refresh) ||
			this.#state.evaluation === null ||
			!("launch" in this.#state.evaluation)
		)
			return false;
		const evaluation = this.#state.evaluation;
		const actionSequence = this.#allocateActionSequence();
		this.#clearAimWork();
		this.#publish({ kind: "commit-pending", evaluation, actionSequence });
		void this.#lifecycle
			.commitPreciseJump({
				sequence: actionSequence,
				camera: evaluation.camera,
				target: evaluation.launch.target,
				power: evaluation.launch.power,
			})
			.catch((error: unknown) => {
				if (
					this.#state.kind === "commit-pending" &&
					this.#state.actionSequence === actionSequence
				) {
					this.#publish({ kind: "targeting", evaluation });
				}
				this.#onError(error);
			});
		return true;
	}

	cancel(): void {
		if (this.#state.kind === "inactive" || this.#destroyed) return;
		const sequence = this.#allocateActionSequence();
		this.#clearAimWork();
		this.#lastRay = null;
		this.#publish({ kind: "inactive" });
		void this.#lifecycle
			.cancelPreciseJump({ sequence })
			.catch((error: unknown) => this.#onError(error));
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.cancel();
		this.#destroyed = true;
		this.#unsubscribe();
		this.#listeners.clear();
	}

	#schedulePendingAim(): void {
		if (
			this.#destroyed ||
			this.#state.kind !== "targeting" ||
			this.#submissionPending ||
			this.#pendingInput === null ||
			this.#cancelCadence !== null
		)
			return;
		const now = this.#cadence.nowMilliseconds();
		const elapsed =
			this.#lastSubmissionMilliseconds === null
				? Number.POSITIVE_INFINITY
				: now - this.#lastSubmissionMilliseconds;
		const delay = Math.max(0, this.#aimEvaluationIntervalMs - elapsed);
		if (delay === 0) {
			this.#submitPendingAim();
			return;
		}
		this.#cancelCadence = this.#cadence.schedule(delay, () => {
			this.#cancelCadence = null;
			this.#submitPendingAim();
		});
	}

	#submitPendingAim(): void {
		if (
			this.#destroyed ||
			this.#state.kind !== "targeting" ||
			this.#submissionPending
		)
			return;
		const pending = this.#pendingInput;
		if (pending === null) return;
		const ray = pending.ray;
		this.#pendingInput = null;
		const sequence = this.#allocateAimSequence();
		const request: ClientPreciseJumpAimRequest = {
			...ray,
			sequence,
			power: this.#power,
		};
		this.#submittedAim = { camera: ray.camera, sequence };
		this.#actorPose = this.#currentActorPose(ray);
		// A picked location may have arrived while this replacement awaited cadence.
		// Start fresh correlation; presentation retains that location as a spinner.
		this.#publish(
			pending.refresh ? this.#state : { kind: "targeting", evaluation: null },
		);
		this.#lastSubmissionMilliseconds = this.#cadence.nowMilliseconds();
		this.#submissionPending = true;
		void this.#lifecycle
			.setPreciseJumpAim(request)
			.catch((error: unknown) => {
				if (this.#submittedAim?.sequence === sequence) {
					this.#submittedAim = null;
					this.#lastRay = null;
				}
				this.#onError(error);
			})
			.finally(() => {
				this.#submissionPending = false;
				this.#schedulePendingAim();
			});
	}

	#clearAimWork(): void {
		this.#cancelCadence?.();
		this.#cancelCadence = null;
		this.#pendingInput = null;
		this.#submittedAim = null;
	}

	#currentActorPose(
		ray: ClientPreciseJumpRay,
	): DynamicEntityWorldPlacement["pose"] | null {
		const entity = this.#lifecycle.mirror.entity(
			ray.camera.playerGuid,
			ray.camera.entityGeneration,
		);
		return entity?.placement.kind === "world" ? entity.placement.pose : null;
	}

	#refreshActorInput(): void {
		if (this.#state.kind !== "targeting" || this.#lastRay === null) return;
		const current = this.#currentActorPose(this.#lastRay);
		if (current === null) return;
		const previous = this.#actorPose;
		if (
			previous !== null &&
			current.landblockId === previous.landblockId &&
			current.coords.x === previous.coords.x &&
			current.coords.y === previous.coords.y &&
			current.coords.z === previous.coords.z
		)
			return;
		this.#actorPose = current;
		this.#pendingInput = { ray: this.#lastRay, refresh: true };
		this.#publish(this.#state);
		this.#schedulePendingAim();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (this.#destroyed) return;
		if (event.type === "dynamic") {
			this.#refreshActorInput();
			return;
		}
		if (event.type === "precise-jump-evaluation") {
			this.#receiveEvaluation(event.evaluation);
			return;
		}
		if (event.type === "precise-jump-transaction-feedback") {
			this.#receiveFeedback(event.feedback);
			return;
		}
		if (
			event.type === "entity-collision-disabled" ||
			event.type === "presentation-discontinuity" ||
			event.type === "exit-requested" ||
			event.type === "camera-started" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.cancel();
		}
	}

	#receiveEvaluation(evaluation: ClientPreciseJumpProgress): void {
		const submitted = this.#submittedAim;
		if (
			this.#state.kind !== "targeting" ||
			submitted === null ||
			this.#pendingInput !== null ||
			evaluation.sequence !== submitted.sequence ||
			!sameCamera(evaluation.camera, submitted.camera)
		)
			return;
		const current = this.#state.evaluation;
		if (
			current !== null &&
			current.sequence === evaluation.sequence &&
			current.phase === "completed"
		)
			return;
		this.#publish({ kind: "targeting", evaluation });
	}

	#receiveFeedback(feedback: ClientPreciseJumpTransactionFeedback): void {
		if (
			this.#state.kind !== "commit-pending" ||
			feedback.sequence !== this.#state.actionSequence
		)
			return;
		if (feedback.outcome.kind === "committed") {
			this.#publish({ kind: "inactive" });
			return;
		}
		// Keep targeting active and update feedback from the current actor after a rejected launch.
		this.#publish({ kind: "targeting", evaluation: null });
		if (this.#lastRay !== null) {
			this.#pendingInput = { ray: this.#lastRay, refresh: false };
			this.#schedulePendingAim();
		}
	}

	#allocateAimSequence(): number {
		if (!Number.isSafeInteger(this.#nextAimSequence))
			throw new Error("Precise-jump aim sequence exhausted.");
		return this.#nextAimSequence++;
	}

	#allocateActionSequence(): number {
		if (!Number.isSafeInteger(this.#nextActionSequence))
			throw new Error("Precise-jump action sequence exhausted.");
		return this.#nextActionSequence++;
	}

	#publish(state: ClientPreciseJumpState): void {
		this.#state = state;
		const refreshing =
			state.kind === "targeting" &&
			state.evaluation !== null &&
			(this.#pendingInput?.refresh === true ||
				(this.#submittedAim !== null &&
					state.evaluation.sequence !== this.#submittedAim.sequence));
		this.#snapshot = {
			refreshing,
			active: state.kind !== "inactive",
			marker: state.kind === "inactive" ? null : state.evaluation,
		};
		for (const listener of this.#listeners) listener(this.#snapshot);
	}
}

function sameCamera(
	left: ClientCameraIdentity,
	right: ClientCameraIdentity,
): boolean {
	return (
		left.cameraGeneration === right.cameraGeneration &&
		left.playerGuid === right.playerGuid &&
		left.entityGeneration === right.entityGeneration
	);
}

/** Identical samples must not cancel a useful solve or invalidate an unchanged launch. */
function sameRay(
	left: ClientPreciseJumpRay,
	right: ClientPreciseJumpRay,
): boolean {
	return (
		sameCamera(left.camera, right.camera) &&
		left.anchor === right.anchor &&
		left.previousCell === right.previousCell &&
		left.maximumDistance === right.maximumDistance &&
		left.start.every((value, index) => value === right.start[index]) &&
		left.direction.every((value, index) => value === right.direction[index])
	);
}
