import type {
	PortalRevealReceipt,
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "./portal-transition-presentation";

/** Explicit origin treatment for a new portal-space transition. */
type PortalTransitionOrigin =
	{ readonly kind: "capture-last-world" } | { readonly kind: "absent" };

/**
 * Presentation-only state for one discontinuous 3D destination.
 *
 * The controller never decides whether a destination is ready and never changes authority. It
 * owns the timed entry and exit edges, waits without a timeout, and emits one reveal receipt after
 * a pure destination frame. A newer generation supersedes the old one without capturing portal
 * space as outgoing content.
 */
type PortalTransitionState =
	| {
			readonly kind: "entering";
			readonly generation: number;
			readonly progress: number;
	  }
	| {
			readonly kind: "waiting";
			readonly generation: number;
	  }
	| {
			readonly kind: "exiting";
			readonly generation: number;
			readonly progress: number;
	  }
	| {
			readonly kind: "revealed-awaiting-handoff";
			readonly generation: number;
	  };

/** Inputs sampled exactly once before one presentation frame. */
interface PortalTransitionAdvance {
	readonly nowMs: number;
	readonly destinationReady: boolean;
}

/** Complete plan and optional sound edge returned by one clock advance. */
interface PortalTransitionAdvanceResult {
	readonly plan: PortalTransitionPresentationPlan;
	/** Sound edge emitted exactly when the destination becomes ready to fade in. */
	readonly audio?: "exit";
}

/** App-local timing policy for the authored portal-space transition. */
export interface PortalTransitionPolicy {
	readonly enterDurationMs: number;
	readonly exitDurationMs: number;
}

export class PortalTransitionController {
	readonly #policy: PortalTransitionPolicy;
	#state: PortalTransitionState | null = null;
	#phaseStartedAtMs: number | null = null;
	#destinationReady = false;
	#tunnelPresented = false;
	#revealEmitted = false;

	constructor(policy: PortalTransitionPolicy) {
		validateDuration("entry", policy.enterDurationMs);
		validateDuration("exit", policy.exitDurationMs);
		this.#policy = { ...policy };
	}

	/** Begin one generation; an already-active portal never captures itself as outgoing. */
	begin(generation: number, origin: PortalTransitionOrigin): void {
		if (!Number.isSafeInteger(generation) || generation < 0) {
			throw new Error(
				"Portal transition generation must be a non-negative safe integer.",
			);
		}
		const current = this.#state;
		const supersedingPortal =
			current !== null && current.kind !== "revealed-awaiting-handoff";
		const effectiveOrigin = supersedingPortal
			? { kind: "absent" as const }
			: origin;
		// Entry is a transform of a real completed world frame. Initial world entry and portal
		// supersession have no such frame, so inventing a black source would be a fake transition.
		this.#state =
			effectiveOrigin.kind === "capture-last-world"
				? {
						kind: "entering",
						generation,
						progress: 0,
					}
				: { kind: "waiting", generation };
		this.#phaseStartedAtMs = null;
		this.#destinationReady = false;
		this.#tunnelPresented = false;
		this.#revealEmitted = false;
	}

	/** Drop presentation state during teardown or a completed mode handoff. */
	reset(): void {
		this.#state = null;
		this.#phaseStartedAtMs = null;
		this.#destinationReady = false;
		this.#tunnelPresented = false;
		this.#revealEmitted = false;
	}

	activeGeneration(): number | null {
		return this.#state?.generation ?? null;
	}

	/** Advance once before one frame and return its complete visual instruction. */
	advance(input: PortalTransitionAdvance): PortalTransitionAdvanceResult {
		if (!Number.isFinite(input.nowMs)) {
			throw new Error("Portal transition clock must be finite.");
		}
		const current = this.#state;
		if (current === null) {
			throw new Error("Cannot advance a portal transition before begin().");
		}
		this.#destinationReady ||= input.destinationReady;

		switch (current.kind) {
			case "entering": {
				const progress = this.#phaseProgress(
					input.nowMs,
					this.#policy.enterDurationMs,
				);
				this.#state =
					progress >= 1
						? { kind: "waiting", generation: current.generation }
						: { ...current, progress };
				return { plan: this.#presentationPlan() };
			}
			case "waiting":
				if (this.#destinationReady && this.#tunnelPresented) {
					this.#phaseStartedAtMs = input.nowMs;
					this.#state = {
						kind: "exiting",
						generation: current.generation,
						progress: this.#policy.exitDurationMs === 0 ? 1 : 0,
					};
					return { audio: "exit", plan: this.#presentationPlan() };
				}
				return { plan: this.#presentationPlan() };
			case "exiting": {
				const progress = this.#phaseProgress(
					input.nowMs,
					this.#policy.exitDurationMs,
				);
				this.#state =
					progress >= 1
						? {
								kind: "revealed-awaiting-handoff",
								generation: current.generation,
							}
						: { ...current, progress };
				return { plan: this.#presentationPlan() };
			}
			case "revealed-awaiting-handoff":
				return { plan: this.#presentationPlan() };
		}
	}

	/** Consume visible-surface proof without sampling time or advancing presentation state. */
	acknowledgePresented(
		receipt: PortalTransitionPresentationReceipt,
	): PortalRevealReceipt | null {
		const state = this.#state;
		if (state === null || receipt.generation !== state.generation) return null;
		if (receipt.kind === "tunnel-only") {
			if (state.kind === "waiting") this.#tunnelPresented = true;
			return null;
		}
		if (state.kind !== "revealed-awaiting-handoff" || this.#revealEmitted) {
			return null;
		}
		this.#revealEmitted = true;
		return { generation: state.generation };
	}

	#phaseProgress(nowMs: number, durationMs: number): number {
		const startedAt = this.#phaseStartedAtMs ?? nowMs;
		this.#phaseStartedAtMs = startedAt;
		return durationMs === 0 ? 1 : clamp01((nowMs - startedAt) / durationMs);
	}

	#presentationPlan(): PortalTransitionPresentationPlan {
		const state = this.#state;
		if (state === null) {
			throw new Error(
				"Portal transition state disappeared while completing tick.",
			);
		}
		switch (state.kind) {
			case "entering":
				return {
					kind: "origin-to-tunnel",
					generation: state.generation,
					progress: state.progress,
				};
			case "waiting":
				return { kind: "tunnel-only", generation: state.generation };
			case "exiting":
				return {
					kind: "tunnel-to-destination",
					generation: state.generation,
					progress: state.progress,
				};
			case "revealed-awaiting-handoff":
				return {
					kind: "destination-only-awaiting-handoff",
					generation: state.generation,
				};
		}
	}
}

function validateDuration(name: "entry" | "exit", durationMs: number): void {
	if (!Number.isFinite(durationMs)) {
		throw new Error(`Portal transition ${name} duration must be finite.`);
	}
	if (durationMs < 0) {
		throw new Error(`Portal transition ${name} duration must be non-negative.`);
	}
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}
