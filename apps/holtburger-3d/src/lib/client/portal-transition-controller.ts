/**
 * Presentation-only state for one discontinuous 3D destination.
 *
 * The controller never decides whether a destination is ready and never changes authority. It
 * consumes the source-neutral installation result supplied by a presentation composition, waits
 * without a timeout, and emits one reveal receipt after a pure destination frame. A newer
 * generation supersedes the old one without capturing the tunnel as outgoing content.
 */
export type PortalTransitionState =
	| {
			readonly kind: "entering";
			readonly generation: number;
			readonly outgoingCaptured: boolean;
	  }
	| {
			readonly kind: "waiting";
			readonly generation: number;
			readonly outgoingCaptured: boolean;
	  }
	| {
			readonly kind: "exiting";
			readonly generation: number;
			readonly outgoingCaptured: boolean;
			readonly progress: number;
	  }
	| {
			readonly kind: "revealed-awaiting-handoff";
			readonly generation: number;
	  };

/** One-shot fact that a pure destination frame was presented for a generation. */
export interface PortalRevealReceipt {
	readonly generation: number;
}

/** Inputs sampled by the presentation frame after installation and rendering. */
export interface PortalTransitionTick {
	readonly nowMs: number;
	readonly activationReady: boolean;
	readonly destinationFrameRendered: boolean;
}

/** Compact update returned to the composing app without exposing transition-owned resources. */
export interface PortalTransitionUpdate {
	readonly state: PortalTransitionState;
	readonly reveal: PortalRevealReceipt | null;
	/** Sound edge emitted exactly when the destination becomes ready to fade in. */
	readonly audio?: "exit";
}

/** App-local policy for the authored tunnel's baseline exit duration. */
export interface PortalTransitionPolicy {
	readonly exitDurationMs: number;
}

/** Shared app policy for fading from the authored tunnel into an installed destination. */
const DEFAULT_PORTAL_TRANSITION_POLICY: PortalTransitionPolicy = Object.freeze({
	exitDurationMs: 2_000,
});

export class PortalTransitionController {
	readonly #policy: PortalTransitionPolicy;
	#state: PortalTransitionState | null = null;
	#exitStartedAtMs: number | null = null;
	#revealEmitted = false;

	constructor(
		policy: PortalTransitionPolicy = DEFAULT_PORTAL_TRANSITION_POLICY,
	) {
		if (!Number.isFinite(policy.exitDurationMs) || policy.exitDurationMs < 0) {
			throw new Error(
				"Portal transition exit duration must be finite and non-negative.",
			);
		}
		this.#policy = { ...policy };
	}

	/** Begin one generation; an already-active portal never captures itself as outgoing. */
	begin(generation: number, outgoingAvailable: boolean): void {
		if (!Number.isSafeInteger(generation) || generation < 0) {
			throw new Error(
				"Portal transition generation must be a non-negative safe integer.",
			);
		}
		const current = this.#state;
		const supersedingPortal =
			current !== null && current.kind !== "revealed-awaiting-handoff";
		this.#state = {
			kind: "entering",
			generation,
			outgoingCaptured: outgoingAvailable && !supersedingPortal,
		};
		this.#exitStartedAtMs = null;
		this.#revealEmitted = false;
	}

	/** Drop presentation state during teardown or a completed mode handoff. */
	reset(): void {
		this.#state = null;
		this.#exitStartedAtMs = null;
		this.#revealEmitted = false;
	}

	state(): PortalTransitionState | null {
		return this.#state;
	}

	/** Advance one presentation edge; waiting has no timeout or synthetic readiness fallback. */
	tick(input: PortalTransitionTick): PortalTransitionUpdate {
		if (!Number.isFinite(input.nowMs)) {
			throw new Error("Portal transition clock must be finite.");
		}
		const current = this.#state;
		if (current === null) {
			throw new Error("Cannot tick a portal transition before begin().");
		}
		if (current.kind === "entering") {
			this.#state = {
				kind: "waiting",
				generation: current.generation,
				outgoingCaptured: current.outgoingCaptured,
			};
		}
		const next = this.#state;
		if (next === null) {
			throw new Error("Portal transition state disappeared while ticking.");
		}
		if (next.kind === "waiting") {
			if (input.activationReady) {
				this.#exitStartedAtMs = input.nowMs;
				this.#state = {
					kind: "exiting",
					generation: next.generation,
					outgoingCaptured: next.outgoingCaptured,
					progress: this.#policy.exitDurationMs === 0 ? 1 : 0,
				};
				return this.#finishTick(input, "exit");
			}
		} else if (next.kind === "exiting") {
			if (input.activationReady) {
				const startedAt = this.#exitStartedAtMs ?? input.nowMs;
				const progress =
					this.#policy.exitDurationMs === 0
						? 1
						: clamp01((input.nowMs - startedAt) / this.#policy.exitDurationMs);
				this.#state =
					progress >= 1
						? {
								kind: "revealed-awaiting-handoff",
								generation: next.generation,
							}
						: {
								kind: "exiting",
								generation: next.generation,
								outgoingCaptured: next.outgoingCaptured,
								progress,
							};
			}
		}
		const state = this.#state;
		if (state === null) {
			throw new Error(
				"Portal transition state disappeared while completing tick.",
			);
		}
		const reveal =
			state.kind === "revealed-awaiting-handoff" &&
			input.destinationFrameRendered &&
			!this.#revealEmitted
				? { generation: state.generation }
				: null;
		if (reveal !== null) this.#revealEmitted = true;
		return { reveal, state };
	}

	#finishTick(
		input: PortalTransitionTick,
		audio: "exit",
	): PortalTransitionUpdate {
		const state = this.#state;
		if (state === null) {
			throw new Error(
				"Portal transition state disappeared while completing tick.",
			);
		}
		const reveal =
			state.kind === "revealed-awaiting-handoff" &&
			input.destinationFrameRendered &&
			!this.#revealEmitted
				? { generation: state.generation }
				: null;
		if (reveal !== null) this.#revealEmitted = true;
		return { audio, reveal, state };
	}
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}
