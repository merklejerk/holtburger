/** Imperative frame-rate source written by a hot frame loop and read by colder UI consumers. */
export interface FrameRateSampler {
	/** Record measured frontend frame work without publishing reactive state. */
	recordFrameWork(frameWorkMs: number, sampledAtMs: number): void;
	/** Read the latest uncapped throughput implied by smoothed frontend frame work. */
	readFramesPerSecond(): number | null;
}

/** Build an elapsed-time-weighted frame-rate sampler with no reactive dependencies. */
export function createFrameRateSampler(emaWindowMs: number): FrameRateSampler {
	if (!Number.isFinite(emaWindowMs) || emaWindowMs <= 0) {
		throw new Error("Frame-rate EMA window must be a positive finite number.");
	}
	let previousSampleAtMs: number | null = null;
	let smoothedFrameWorkMs: number | null = null;

	return {
		recordFrameWork(frameWorkMs, sampledAtMs): void {
			if (!Number.isFinite(frameWorkMs) || frameWorkMs < 0) {
				throw new Error("Frame work duration must be finite and non-negative.");
			}
			if (!Number.isFinite(sampledAtMs)) {
				throw new Error("Frame sample timestamp must be finite.");
			}
			if (previousSampleAtMs !== null && sampledAtMs < previousSampleAtMs) {
				throw new Error("Frame sample timestamps must not move backwards.");
			}
			if (smoothedFrameWorkMs === null || previousSampleAtMs === null) {
				smoothedFrameWorkMs = frameWorkMs;
				previousSampleAtMs = sampledAtMs;
				return;
			}
			const elapsedMs = sampledAtMs - previousSampleAtMs;
			const alpha = 1 - Math.exp(-elapsedMs / emaWindowMs);
			smoothedFrameWorkMs += (frameWorkMs - smoothedFrameWorkMs) * alpha;
			previousSampleAtMs = sampledAtMs;
		},
		readFramesPerSecond(): number | null {
			return smoothedFrameWorkMs === null
				? null
				: 1_000 / Math.max(smoothedFrameWorkMs, 0.001);
		},
	};
}
