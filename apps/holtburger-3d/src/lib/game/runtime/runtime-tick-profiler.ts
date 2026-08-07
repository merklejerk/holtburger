/**
 * Per-phase timing for the runtime's update tick, which the renderer profile does not cover.
 *
 * The renderer profile explains draw cost. This explains everything before it: advancing scripts,
 * simulating particles, sampling animation, publishing presentation into the scene, and building the
 * particle cohorts the renderer consumes.
 *
 * Always on, unlike renderer profiling. This is seven `performance.now()` calls at frame granularity
 * rather than per-draw clocks, `PhysicsScriptSystem` already times its own advance the same way, and
 * a diagnostic nobody remembers to enable is a diagnostic nobody has when they need it.
 */

/** One tick's phase durations, in milliseconds. */
export interface RuntimeTickTimings {
	/** Physics-script clock advancement, including every command it dispatches. */
	readonly scriptAdvanceMs: number;
	/** Particle emission, expiry, and envelope maintenance. */
	readonly particleAdvanceMs: number;
	/** Animation clock advancement and presentation-cadence selection. */
	readonly animationAdvanceMs: number;
	/** Sampling animation and publishing part transforms into the scene graph. */
	readonly presentationPublishMs: number;
	/** Grouping live particles into draw cohorts and handing them to the renderer. */
	readonly particleCohortMs: number;
	/** The renderer's own `drawFrame`, which its profile breaks down further. */
	readonly renderMs: number;
	/** Post-frame animation bookkeeping against renderer feedback. */
	readonly frameCompletionMs: number;
	/** Wall-clock across the whole tick, so unattributed work is visible as the shortfall. */
	readonly totalMs: number;
}

/** Latest tick plus a mean across the retained window. */
export interface RuntimeTickProfile {
	readonly latest: RuntimeTickTimings;
	readonly mean: RuntimeTickTimings;
	readonly sampleCount: number;
}

const TIMING_KEYS = [
	"scriptAdvanceMs",
	"particleAdvanceMs",
	"animationAdvanceMs",
	"presentationPublishMs",
	"particleCohortMs",
	"renderMs",
	"frameCompletionMs",
	"totalMs",
] as const satisfies readonly (keyof RuntimeTickTimings)[];

/** Frames retained for the mean; one second at sixty frames, matching the renderer's window. */
const WINDOW_SIZE = 60;

export class RuntimeTickProfiler {
	readonly #samples: RuntimeTickTimings[] = [];

	record(timings: RuntimeTickTimings): void {
		this.#samples.push(timings);
		if (this.#samples.length > WINDOW_SIZE) this.#samples.shift();
	}

	/** Null until the first tick completes, so a caller never reports zeros as a measurement. */
	getProfile(): RuntimeTickProfile | null {
		const latest = this.#samples.at(-1);
		if (!latest) return null;
		const totals = Object.fromEntries(
			TIMING_KEYS.map((key) => [key, 0]),
		) as Record<keyof RuntimeTickTimings, number>;
		for (const sample of this.#samples) {
			for (const key of TIMING_KEYS) totals[key] += sample[key];
		}
		const sampleCount = this.#samples.length;
		return {
			latest,
			mean: Object.fromEntries(
				TIMING_KEYS.map((key) => [key, totals[key] / sampleCount]),
			) as unknown as RuntimeTickTimings,
			sampleCount,
		};
	}
}
