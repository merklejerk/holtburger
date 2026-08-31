import type {
	ClientCameraIdentity,
	ClientPreciseJumpAimRequest,
	ClientPreciseJumpEvaluation,
	ClientPreciseJumpTransactionFeedback,
} from "./client-host-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";

export type ClientPreciseJumpRay = Omit<
	ClientPreciseJumpAimRequest,
	"sequence"
>;

export type ClientPreciseJumpState =
	| { readonly kind: "inactive" }
	| {
			readonly kind: "targeting";
			readonly evaluation: ClientPreciseJumpEvaluation | null;
	  }
	| {
			readonly kind: "commit-pending";
			readonly evaluation: ClientPreciseJumpEvaluation;
			readonly actionSequence: number;
	  };

/** Consumer-facing split between cold mode UI and the imperative presentation payload. */
export interface ClientPreciseJumpSnapshot {
	/** Cold mode discriminant consumed by input and markup. */
	readonly active: boolean;
	/** Latest accepted target forwarded directly to world presentation. */
	readonly marker: ClientPreciseJumpEvaluation | null;
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
	readonly #listeners = new Set<
		(snapshot: ClientPreciseJumpSnapshot) => void
	>();
	readonly #unsubscribe: () => void;
	#state: ClientPreciseJumpState = { kind: "inactive" };
	#snapshot: ClientPreciseJumpSnapshot = { active: false, marker: null };
	#nextAimSequence = 1;
	#nextActionSequence = 1;
	#lastDisplayedAimSequence = 0;
	#lastSubmissionMilliseconds: number | null = null;
	#submittedAim: SubmittedPreciseJumpAim | null = null;
	#pendingRay: ClientPreciseJumpRay | null = null;
	#cancelCadence: (() => void) | null = null;
	#destroyed = false;

	constructor(
		lifecycle: ClientLifecycleSession,
		onError: (error: unknown) => void = () => undefined,
		cadence: ClientPreciseJumpCadence = browserPreciseJumpCadence,
	) {
		this.#lifecycle = lifecycle;
		this.#onError = onError;
		this.#cadence = cadence;
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
		this.#lastDisplayedAimSequence = 0;
		this.#lastSubmissionMilliseconds = null;
		this.#submittedAim = null;
		this.#pendingRay = null;
		this.#publish({ kind: "targeting", evaluation: null });
	}

	/** Replace the latest pointer sample without queueing pointer history. */
	aim(ray: ClientPreciseJumpRay): void {
		if (this.#state.kind !== "targeting" || this.#destroyed) return;
		this.#pendingRay = ray;
		this.#schedulePendingAim();
	}

	/** Commit only the latest blue evaluation; red and neutral activation are deliberate no-ops. */
	activate(): boolean {
		if (
			this.#state.kind !== "targeting" ||
			this.#state.evaluation?.status !== "reachable"
		)
			return false;
		const evaluation = this.#state.evaluation;
		const actionSequence = this.#allocateActionSequence();
		this.#clearAimWork();
		this.#publish({ kind: "commit-pending", evaluation, actionSequence });
		void this.#lifecycle
			.commitPreciseJump({
				sequence: actionSequence,
				evaluationId: evaluation.evaluationId,
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
		this.#lastDisplayedAimSequence = 0;
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
			this.#submittedAim !== null ||
			this.#pendingRay === null ||
			this.#cancelCadence !== null
		)
			return;
		const now = this.#cadence.nowMilliseconds();
		const elapsed =
			this.#lastSubmissionMilliseconds === null
				? Number.POSITIVE_INFINITY
				: now - this.#lastSubmissionMilliseconds;
		const delay = Math.max(
			0,
			CLIENT_TUNING.preciseJump.aimEvaluationIntervalMs - elapsed,
		);
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
			this.#submittedAim !== null
		)
			return;
		const ray = this.#pendingRay;
		if (ray === null) return;
		this.#pendingRay = null;
		const sequence = this.#allocateAimSequence();
		const request: ClientPreciseJumpAimRequest = { ...ray, sequence };
		this.#submittedAim = { camera: ray.camera, sequence };
		this.#lastSubmissionMilliseconds = this.#cadence.nowMilliseconds();
		void this.#lifecycle.setPreciseJumpAim(request).catch((error: unknown) => {
			if (this.#submittedAim?.sequence === sequence) {
				this.#submittedAim = null;
				this.#schedulePendingAim();
			}
			this.#onError(error);
		});
	}

	#clearAimWork(): void {
		this.#cancelCadence?.();
		this.#cancelCadence = null;
		this.#pendingRay = null;
		this.#submittedAim = null;
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (this.#destroyed) return;
		if (event.type === "precise-jump-evaluation") {
			this.#receiveEvaluation(event.evaluation);
			return;
		}
		if (event.type === "precise-jump-transaction-feedback") {
			this.#receiveFeedback(event.feedback);
			return;
		}
		if (
			event.type === "presentation-discontinuity" ||
			event.type === "exit-requested" ||
			event.type === "camera-started" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.cancel();
		}
	}

	#receiveEvaluation(evaluation: ClientPreciseJumpEvaluation): void {
		const submitted = this.#submittedAim;
		if (
			this.#state.kind !== "targeting" ||
			submitted === null ||
			evaluation.sequence !== submitted.sequence ||
			!sameCamera(evaluation.camera, submitted.camera) ||
			evaluation.sequence <= this.#lastDisplayedAimSequence
		)
			return;
		this.#submittedAim = null;
		this.#lastDisplayedAimSequence = evaluation.sequence;
		this.#publish({ kind: "targeting", evaluation });
		this.#schedulePendingAim();
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
		// A rejection keeps targeting active, but the core may have consumed the retained authority.
		this.#publish({ kind: "targeting", evaluation: null });
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
		this.#snapshot = {
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
