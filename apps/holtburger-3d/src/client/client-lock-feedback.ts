import type { ClientLockFeedback } from "./client-lock-feedback-contract";
import type { ClientEntityScreenPoint } from "./client-entity-projection";

/** Lifetimes supplied by frontend policy, independent of server semantics. */
interface LockFeedbackTiming {
	/** Total duration of the opening and fade. */
	readonly successLifetimeMs: number;
	/** Total duration of the subdued shake and fade. */
	readonly failureLifetimeMs: number;
}
/** One active observation; coordinates are resolved only by the frame consumer. */
interface ActiveLockFeedback {
	/** Original incarnation-qualified observation. */
	readonly feedback: ClientLockFeedback;
	/** Monotonic replacement identity, including consecutive identical outcomes. */
	readonly revision: number;
	/** Receipt clock; visibility never restarts the lifetime. */
	readonly startedAtMs: number;
	/** Captured duration used by expiry and CSS animation together. */
	readonly lifetimeMs: number;
}
/** Frame-current presentation values for one DOM marker. */
export interface ClientLockFeedbackFrame extends ClientEntityScreenPoint {
	/** One marker per target; revisions restart its animation. */
	readonly target: number;
	/** Monotonic replacement identity, including consecutive identical outcomes. */
	readonly revision: number;
	/** Selects opening or failure artwork motion. */
	readonly outcome: ClientLockFeedback["outcome"];
	/** Negative CSS animation delay preserves age after temporary clipping. */
	readonly elapsedMs: number;
	/** Captured duration used by expiry and CSS animation together. */
	readonly lifetimeMs: number;
}

/** App-local transient state; selection and helper visibility never own its lifetime. */
export class ClientLockFeedbackEffects {
	readonly #active = new Map<number, ActiveLockFeedback>();
	#revision = 0;

	accept(
		feedback: ClientLockFeedback,
		nowMs: number,
		timing: LockFeedbackTiming,
	): void {
		this.#active.set(feedback.target, {
			feedback,
			revision: ++this.#revision,
			startedAtMs: nowMs,
			lifetimeMs:
				feedback.outcome === "unlocked"
					? timing.successLifetimeMs
					: timing.failureLifetimeMs,
		});
	}

	/** A retired incarnation must never resume its animation after re-admission. */
	remove(target: number, generation: number): void {
		if (this.#active.get(target)?.feedback.generation === generation)
			this.#active.delete(target);
	}

	clear(): void {
		this.#active.clear();
	}

	/** Expire while offscreen too; project only an exact live target incarnation. */
	readFrames(
		nowMs: number,
		worldGeneration: number,
		project: (feedback: ClientLockFeedback) => ClientEntityScreenPoint | null,
	): readonly ClientLockFeedbackFrame[] {
		const frames: ClientLockFeedbackFrame[] = [];
		for (const [target, active] of this.#active) {
			const elapsedMs = nowMs - active.startedAtMs;
			if (
				active.feedback.worldGeneration !== worldGeneration ||
				elapsedMs >= active.lifetimeMs
			) {
				this.#active.delete(target);
				continue;
			}
			const point = project(active.feedback);
			if (point !== null)
				frames.push({
					...point,
					target,
					revision: active.revision,
					outcome: active.feedback.outcome,
					elapsedMs,
					lifetimeMs: active.lifetimeMs,
				});
		}
		return frames;
	}
}
