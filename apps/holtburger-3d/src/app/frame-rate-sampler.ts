/** Observed presentation cadence and estimated capacity without the scheduling cap. */
export interface FrameRates {
	/** Frames delivered per second by the frontend presentation loop. */
	readonly capped: number;
	/** Best-effort frame capacity after charging delays beyond the learned callback cadence. */
	readonly uncapped: number;
}

/** One complete frontend frame measured at its scheduling boundary. */
export interface FrameRateSample {
	/** Scheduling timestamp: native animation time or the cadence pacer's monotonic clock. */
	readonly animationFrameTimeMs: number;
	/** Time at which the presentation callback began executing. */
	readonly startedAtMs: number;
	/** Synchronous work performed by the callback. */
	readonly workMs: number;
}

/** Imperative frame-rate source written by a hot frame loop and read by colder UI consumers. */
export interface FrameRateSampler {
	/** Record one presentation callback without publishing reactive state. */
	recordFrame(sample: FrameRateSample): void;
	/** Read the latest observed cadence and best-effort uncapped capacity. */
	readFrameRates(): FrameRates | null;
}

/**
 * Callback intervals retained to distinguish ordinary scheduled waiting from excess event-loop delay.
 * A short window adapts when the window moves between monitors without letting one stall redefine
 * the display cadence.
 */
const REFRESH_INTERVAL_SAMPLE_COUNT = 30;

/** Smoothed inputs from which both displayed rates are derived. */
interface SmoothedFrameMetrics {
	readonly workMs: number;
	/** Elapsed-time-weighted delivered frame rate. */
	readonly framesPerSecond: number;
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
	let smoothedMetrics: SmoothedFrameMetrics | null = null;
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
				throw new Error(
					`Animation-frame timestamps must increase. Previous=${previousSample.animationFrameTimeMs}, current=${animationFrameTimeMs}, start=${startedAtMs}.`,
				);
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
			// Delay within one learned interval is presumed to be deliberate scheduling. Only the
			// excess is charged to the uncapped estimate as otherwise-hidden main-thread work.
			const excessDelayMs = Math.max(0, frameIntervalMs - refreshIntervalMs);
			const alpha = 1 - Math.exp(-frameIntervalMs / emaWindowMs);
			const framesPerSecond = 1_000 / Math.max(frameIntervalMs, 0.001);

			const previousMetrics = smoothedMetrics;
			if (previousMetrics === null) {
				smoothedMetrics = {
					workMs: smooth(previousSample.workMs, workMs, alpha),
					framesPerSecond,
					excessDelayMs,
				};
			} else {
				smoothedMetrics = {
					workMs: smooth(previousMetrics.workMs, workMs, alpha),
					// Elapsed-time weighting belongs on the rate. Applying it to intervals before
					// taking their reciprocal counts long gaps twice and understates jittery cadence.
					framesPerSecond: smooth(
						previousMetrics.framesPerSecond,
						framesPerSecond,
						alpha,
					),
					excessDelayMs: smooth(
						previousMetrics.excessDelayMs,
						excessDelayMs,
						alpha,
					),
				};
			}
			previousSample = sample;
		},
		readFrameRates(): FrameRates | null {
			if (smoothedMetrics === null) return null;
			const capped = smoothedMetrics.framesPerSecond;
			const estimatedCapacity =
				1_000 /
				Math.max(smoothedMetrics.workMs + smoothedMetrics.excessDelayMs, 0.001);
			return {
				capped,
				uncapped: Math.max(capped, estimatedCapacity),
			};
		},
	};
}
