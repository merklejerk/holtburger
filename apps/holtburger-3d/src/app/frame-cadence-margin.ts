import { startPresentationFrameLoop } from "./presentation-frame-loop";

/** Number of display intervals retained while following monitor cadence changes. */
const DISPLAY_INTERVAL_SAMPLES = 30;

/** Resolve a CLI render cadence margin against the mode-owned tuning default. */
export function readFrameCadenceMargin(
	search: string,
	defaultPercent: number,
): number {
	const raw = new URLSearchParams(search).get("frame-cadence-margin");
	const percent = raw === null ? defaultPercent : Number(raw);
	if (
		(raw !== null && raw.trim() === "") ||
		!Number.isFinite(percent) ||
		percent < 0 ||
		percent > 100
	)
		throw new Error(
			"Frame cadence margin must be a percentage from 0 through 100.",
		);
	return percent;
}

/**
 * Main-view pacing above display refresh, without changing GPU vsync.
 *
 * Observe native animation frames separately from rendering. Each paced frame runs in an ordinary
 * task so host messages and UI work can run between frames. Keep one outstanding task, retain phase
 * through ordinary jitter, and reset after a full missed period rather than replaying stale slots.
 */
export function startFrameLoopWithCadenceMargin(
	frame: FrameRequestCallback,
	minimumFrameIntervalMs: () => number,
	marginPercent: number,
): () => void {
	if (marginPercent === 0)
		return startPresentationFrameLoop(frame, minimumFrameIntervalMs);
	if (
		!Number.isFinite(marginPercent) ||
		marginPercent < 0 ||
		marginPercent > 100
	)
		throw new Error(
			"Frame cadence margin must be a percentage from 0 through 100.",
		);

	let stopped = false;
	let pendingTask: AbortController | null = null;
	let previousDisplayTime: number | null = null;
	let refreshInterval: number | null = null;
	let nextDeadline: number | null = null;
	let previousFrameTime: number | null = null;
	const intervals: number[] = [];
	const deliver = (): void => {
		const now = performance.now();
		if (
			now !== previousFrameTime &&
			(previousFrameTime === null ||
				now - previousFrameTime >= minimumFrameIntervalMs())
		) {
			previousFrameTime = now;
			frame(now);
		}
	};
	const schedule = (): void => {
		if (stopped || pendingTask !== null || refreshInterval === null) return;
		const period = refreshInterval / (1 + marginPercent / 100);
		const deadline = nextDeadline ?? performance.now() + period;
		const controller = new AbortController();
		pendingTask = controller;
		void window.scheduler
			.postTask(
				() => {
					pendingTask = null;
					if (stopped || !document.hasFocus()) {
						nextDeadline = null;
						return;
					}
					const now = performance.now();
					nextDeadline =
						now - deadline >= period ? now + period : deadline + period;
					deliver();
					schedule();
				},
				{
					priority: "user-visible",
					delay: Math.max(0, Math.ceil(deadline - performance.now())),
					signal: controller.signal,
				},
			)
			.catch((error: unknown) => {
				if (!controller.signal.aborted) window.reportError(error);
			});
	};
	const stopObserver = startPresentationFrameLoop(
		(time) => {
			if (!document.hasFocus()) {
				pendingTask?.abort();
				pendingTask = null;
				nextDeadline = null;
				previousDisplayTime = null;
				deliver();
				return;
			}
			if (previousDisplayTime !== null) {
				intervals.push(time - previousDisplayTime);
				if (intervals.length > DISPLAY_INTERVAL_SAMPLES) intervals.shift();
				if (intervals.length === DISPLAY_INTERVAL_SAMPLES) {
					const shortest = Math.min(...intervals);
					// Ignore missed refreshes; average ordinary intervals to remove timestamp rounding.
					const ordinary = intervals.filter(
						(interval) => interval < shortest * 1.25,
					);
					refreshInterval =
						ordinary.reduce((sum, interval) => sum + interval, 0) /
						ordinary.length;
				}
			}
			previousDisplayTime = time;
			if (refreshInterval === null) deliver();
			else schedule();
		},
		() => 0,
	);
	return () => {
		stopped = true;
		stopObserver();
		pendingTask?.abort();
		pendingTask = null;
	};
}
