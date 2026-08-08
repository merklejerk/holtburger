/**
 * Optional per-phase timing for the runtime's update tick, which renderer profiling does not cover.
 *
 * Renderer profiling explains draw cost. This explains everything before it: advancing scripts,
 * simulating particles, sampling animation, publishing presentation into the scene, and building the
 * owner-local particle sources the renderer consumes.
 *
 * Deliberately an **optional injected observer** rather than something the runtime owns. A profiler
 * is diagnostic infrastructure, so a production runtime should not be obliged to construct one or
 * carry its state, and the tick should not read as measurement with rendering in between. Absent,
 * the tick pays one skipped optional call per phase and `getTickProfile` reports nothing.
 */

/** Update-tick phases, in the order the runtime marks them. */
export const RUNTIME_TICK_PHASES = [
	"scriptAdvance",
	"particleAdvance",
	"animationAdvance",
	"presentationPublish",
	"particleCohort",
	"render",
	"frameCompletion",
] as const;

export type RuntimeTickPhase = (typeof RUNTIME_TICK_PHASES)[number];

/** One tick's phase durations in milliseconds, plus the wall-clock total. */
export type RuntimeTickTimings = Record<RuntimeTickPhase, number> & {
	/** Wall-clock across the whole tick, so unattributed work shows as the shortfall. */
	readonly totalMs: number;
};

/** Latest tick plus a mean across the retained window. */
export interface RuntimeTickProfile {
	readonly latest: RuntimeTickTimings;
	readonly mean: RuntimeTickTimings;
	readonly sampleCount: number;
}

/** Frames retained for the mean; one second at sixty frames, matching the renderer's window. */
const WINDOW_SIZE = 60;

function emptyTimings(): Record<RuntimeTickPhase | "totalMs", number> {
	const timings = { totalMs: 0 } as Record<
		RuntimeTickPhase | "totalMs",
		number
	>;
	for (const phase of RUNTIME_TICK_PHASES) timings[phase] = 0;
	return timings;
}

export class RuntimeTickProfiler {
	readonly #clock: () => number;
	readonly #samples: RuntimeTickTimings[] = [];
	#current: Record<RuntimeTickPhase | "totalMs", number> | null = null;
	#tickStartedAt = 0;
	#lastMarkAt = 0;

	/** The clock is injected so tests measure exact durations rather than real elapsed time. */
	constructor(clock: () => number = () => performance.now()) {
		this.#clock = clock;
	}

	/** Open a tick. An unfinished previous tick is discarded rather than blended into this one. */
	beginTick(): void {
		this.#current = emptyTimings();
		this.#tickStartedAt = this.#clock();
		this.#lastMarkAt = this.#tickStartedAt;
	}

	/** Close one phase, attributing everything since the previous mark to it. */
	mark(phase: RuntimeTickPhase): void {
		const current = this.#current;
		if (!current) return;
		const now = this.#clock();
		current[phase] += now - this.#lastMarkAt;
		this.#lastMarkAt = now;
	}

	/** Close the tick and retain it. */
	finishTick(): void {
		const current = this.#current;
		if (!current) return;
		current.totalMs = this.#clock() - this.#tickStartedAt;
		this.#current = null;
		this.#samples.push(current as RuntimeTickTimings);
		if (this.#samples.length > WINDOW_SIZE) this.#samples.shift();
	}

	/** Null until the first tick completes, so a caller never reports zeros as a measurement. */
	getProfile(): RuntimeTickProfile | null {
		const latest = this.#samples.at(-1);
		if (!latest) return null;
		const totals = emptyTimings();
		for (const sample of this.#samples) {
			totals.totalMs += sample.totalMs;
			for (const phase of RUNTIME_TICK_PHASES) totals[phase] += sample[phase];
		}
		const sampleCount = this.#samples.length;
		const mean = emptyTimings();
		mean.totalMs = totals.totalMs / sampleCount;
		for (const phase of RUNTIME_TICK_PHASES) {
			mean[phase] = totals[phase] / sampleCount;
		}
		return { latest, mean: mean as RuntimeTickTimings, sampleCount };
	}
}
