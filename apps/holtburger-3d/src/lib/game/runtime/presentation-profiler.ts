/** Sequential presentation-frame scopes. Rendering contains the renderer's own CPU profile. */
export const PRESENTATION_FRAME_PHASES = [
	"effects",
	"audio",
	"animation",
	"render",
] as const;

/** A phase closes the elapsed span since the previous boundary. */
export type PresentationFramePhase = (typeof PRESENTATION_FRAME_PHASES)[number];

/** One presentation frame; total includes any unmarked trailing work. */
export type PresentationFrameTimings = Record<
	PresentationFramePhase,
	number
> & {
	readonly totalMs: number;
};

/** Latest frame and arithmetic mean over all frames since reset. */
export interface PresentationFrameProfile {
	readonly latest: PresentationFrameTimings;
	readonly mean: PresentationFrameTimings;
	readonly sampleCount: number;
}

/** Independent elapsed work samples; update calls need not pair with rendered frames. */
interface PresentationWorkProfile {
	readonly latestMs: number;
	readonly meanMs: number;
	readonly sampleCount: number;
}

/** The complete runtime diagnostic read keeps render and update coverage distinct. */
export interface PresentationProfile {
	readonly frame: PresentationFrameProfile | null;
	readonly work: {
		readonly contentCommit: PresentationWorkProfile | null;
		readonly placementAdvance: PresentationWorkProfile | null;
	};
}

/** Bounded totals for one synchronous runtime operation. */
interface WorkAggregate {
	latestMs: number;
	totalMs: number;
	sampleCount: number;
}

function summarizeWork(work: WorkAggregate): PresentationWorkProfile | null {
	return work.sampleCount === 0
		? null
		: {
				latestMs: work.latestMs,
				meanMs: work.totalMs / work.sampleCount,
				sampleCount: work.sampleCount,
			};
}

function emptyTimings(): PresentationFrameTimings {
	return { effects: 0, audio: 0, animation: 0, render: 0, totalMs: 0 };
}

/** Created only for an explicit profiling session; retains bounded aggregate state. */
export class PresentationProfiler {
	readonly #clock: () => number;
	#totals = emptyTimings();
	#contentCommit: WorkAggregate = { latestMs: 0, totalMs: 0, sampleCount: 0 };
	#placementAdvance: WorkAggregate = {
		latestMs: 0,
		totalMs: 0,
		sampleCount: 0,
	};
	#sampleCount = 0;
	#latest: PresentationFrameTimings | null = null;
	#current: PresentationFrameTimings | null = null;
	#startedAt = 0;
	#lastMarkAt = 0;

	constructor(clock: () => number = () => performance.now()) {
		this.#clock = clock;
	}

	/** Discard aggregate and in-flight work at the measurement boundary. */
	reset(): void {
		this.#totals = emptyTimings();
		this.#contentCommit = { latestMs: 0, totalMs: 0, sampleCount: 0 };
		this.#placementAdvance = { latestMs: 0, totalMs: 0, sampleCount: 0 };
		this.#sampleCount = 0;
		this.#latest = null;
		this.#current = null;
	}

	beginFrame(): void {
		this.#current = emptyTimings();
		this.#startedAt = this.#clock();
		this.#lastMarkAt = this.#startedAt;
	}

	mark(phase: PresentationFramePhase): void {
		if (!this.#current) return;
		const now = this.#clock();
		this.#current[phase] += now - this.#lastMarkAt;
		this.#lastMarkAt = now;
	}

	finishFrame(): void {
		const current = this.#current;
		if (!current) return;
		const completed = { ...current, totalMs: this.#clock() - this.#startedAt };
		this.#current = null;
		this.#latest = completed;
		this.#sampleCount++;
		this.#totals = {
			...this.#totals,
			totalMs: this.#totals.totalMs + completed.totalMs,
		};
		for (const phase of PRESENTATION_FRAME_PHASES)
			this.#totals[phase] += completed[phase];
	}

	/** Open an owner-named synchronous operation; reset detaches its aggregate if unfinished. */
	beginWork(phase: "contentCommit" | "placementAdvance"): () => void {
		const aggregate =
			phase === "contentCommit" ? this.#contentCommit : this.#placementAdvance;
		const startedAt = this.#clock();
		return () => {
			const elapsedMs = this.#clock() - startedAt;
			aggregate.latestMs = elapsedMs;
			aggregate.totalMs += elapsedMs;
			aggregate.sampleCount++;
		};
	}

	/** One read exposes independently sampled update work and nested render-frame detail. */
	getProfile(): PresentationProfile {
		return {
			frame: this.#frameProfile(),
			work: {
				contentCommit: summarizeWork(this.#contentCommit),
				placementAdvance: summarizeWork(this.#placementAdvance),
			},
		};
	}

	#frameProfile(): PresentationFrameProfile | null {
		if (!this.#latest) return null;
		const mean = {
			...this.#totals,
			totalMs: this.#totals.totalMs / this.#sampleCount,
		};
		for (const phase of PRESENTATION_FRAME_PHASES)
			mean[phase] /= this.#sampleCount;
		return { latest: this.#latest, mean, sampleCount: this.#sampleCount };
	}
}
