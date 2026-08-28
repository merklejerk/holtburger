/** Observed presentation cadence and estimated capacity without the display refresh cap. */
export interface FrameRates {
	/** Frames delivered per second by requestAnimationFrame. */
	readonly capped: number;
	/** Best-effort frame capacity after charging delays beyond the learned refresh cadence. */
	readonly uncapped: number;
}

/** One complete frontend frame measured at the requestAnimationFrame boundary. */
export interface FrameRateSample {
	/** Browser-supplied requestAnimationFrame timestamp used to learn display cadence. */
	readonly animationFrameTimeMs: number;
	/** Time at which the requestAnimationFrame callback began executing. */
	readonly startedAtMs: number;
	/** Synchronous work performed by the callback. */
	readonly workMs: number;
}

/** Imperative frame-rate source written by a hot frame loop and read by colder UI consumers. */
export interface FrameRateSampler {
	/** Record one requestAnimationFrame callback without publishing reactive state. */
	recordFrame(sample: FrameRateSample): void;
	/** Read the latest observed cadence and best-effort uncapped capacity. */
	readFrameRates(): FrameRates | null;
}

/**
 * Refresh intervals retained to distinguish ordinary display waiting from excess event-loop delay.
 * A short window adapts when the window moves between monitors without letting one stall redefine
 * the display cadence.
 */
const REFRESH_INTERVAL_SAMPLE_COUNT = 30;

/** Smoothed inputs from which both displayed rates are derived. */
interface SmoothedFrameTimes {
	readonly workMs: number;
	readonly intervalMs: number;
	readonly excessDelayMs: number;
}

const smooth = (current: number, next: number, alpha: number): number =>
	current + (next - current) * alpha;

/** Build an elapsed-time-weighted frame-rate sampler with no reactive dependencies. */
export function createFrameRateSampler(emaWindowMs: number): FrameRateSampler {
	if (!Number.isFinite(emaWindowMs)) {
		throw new Error("Frame-rate EMA window must be finite.");
	}
	if (emaWindowMs <= 0) {
		throw new Error("Frame-rate EMA window must be positive.");
	}
	let previousSample: FrameRateSample | null = null;
	let smoothedTimes: SmoothedFrameTimes | null = null;
	const refreshIntervals = new Float64Array(REFRESH_INTERVAL_SAMPLE_COUNT);
	let refreshIntervalCount = 0;
	let nextRefreshIntervalIndex = 0;

	const recordRefreshInterval = (intervalMs: number): number => {
		refreshIntervals[nextRefreshIntervalIndex] = intervalMs;
		nextRefreshIntervalIndex =
			(nextRefreshIntervalIndex + 1) % REFRESH_INTERVAL_SAMPLE_COUNT;
		refreshIntervalCount = Math.min(
			refreshIntervalCount + 1,
			REFRESH_INTERVAL_SAMPLE_COUNT,
		);

		let minimumIntervalMs = refreshIntervals[0];
		for (let index = 1; index < refreshIntervalCount; index += 1) {
			minimumIntervalMs = Math.min(minimumIntervalMs, refreshIntervals[index]);
		}
		return minimumIntervalMs;
	};

	return {
		recordFrame({
			animationFrameTimeMs,
			startedAtMs,
			workMs,
		}: FrameRateSample): void {
			if (!Number.isFinite(animationFrameTimeMs)) {
				throw new Error("Animation-frame timestamp must be finite.");
			}
			if (!Number.isFinite(startedAtMs)) {
				throw new Error("Frame start timestamp must be finite.");
			}
			if (!Number.isFinite(workMs)) {
				throw new Error("Frame work duration must be finite.");
			}
			if (workMs < 0) {
				throw new Error("Frame work duration must be non-negative.");
			}
			if (
				previousSample !== null &&
				animationFrameTimeMs <= previousSample.animationFrameTimeMs
			) {
				throw new Error("Animation-frame timestamps must increase.");
			}
			if (
				previousSample !== null &&
				startedAtMs <= previousSample.startedAtMs
			) {
				throw new Error("Frame start timestamps must increase.");
			}

			const sample = { animationFrameTimeMs, startedAtMs, workMs };
			if (previousSample === null) {
				previousSample = sample;
				return;
			}

			const frameIntervalMs = startedAtMs - previousSample.startedAtMs;
			const animationFrameIntervalMs =
				animationFrameTimeMs - previousSample.animationFrameTimeMs;
			const refreshIntervalMs = recordRefreshInterval(animationFrameIntervalMs);
			// Delay within one refresh interval is presumed to be deliberate rAF waiting. Only the
			// excess is charged to the uncapped estimate as otherwise-hidden main-thread work.
			const excessDelayMs = Math.max(0, frameIntervalMs - refreshIntervalMs);
			const alpha = 1 - Math.exp(-frameIntervalMs / emaWindowMs);

			const previousTimes = smoothedTimes;
			if (previousTimes === null) {
				smoothedTimes = {
					workMs: smooth(previousSample.workMs, workMs, alpha),
					intervalMs: frameIntervalMs,
					excessDelayMs,
				};
			} else {
				smoothedTimes = {
					workMs: smooth(previousTimes.workMs, workMs, alpha),
					intervalMs: smooth(previousTimes.intervalMs, frameIntervalMs, alpha),
					excessDelayMs: smooth(
						previousTimes.excessDelayMs,
						excessDelayMs,
						alpha,
					),
				};
			}
			previousSample = sample;
		},
		readFrameRates(): FrameRates | null {
			if (smoothedTimes === null) return null;
			const capped = 1_000 / Math.max(smoothedTimes.intervalMs, 0.001);
			const estimatedCapacity =
				1_000 /
				Math.max(smoothedTimes.workMs + smoothedTimes.excessDelayMs, 0.001);
			return {
				capped,
				uncapped: Math.max(capped, estimatedCapacity),
			};
		},
	};
}
