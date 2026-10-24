/** Maximum presentation cadence while the app window lacks focus. */
export const BACKGROUND_FRAME_INTERVAL_MS = 1_000 / 10;

/**
 * Schedule complete presentation frames, returning their lifecycle cleanup.
 *
 * Gate before any presentation work, preserving update/draw ordering. Keep requesting browser
 * frames so focus recovery takes effect on the next available frame without another event owner.
 * Re-arm through an ordinary task: Chromium can continuously prioritize uncapped compositor
 * frames during pointer drags, starving host-message delivery if we immediately request another
 * frame. The task boundary lets world updates run without capping frames or moving drawing out of
 * requestAnimationFrame. Browser visibility throttling still owns hidden windows.
 */
export function startPresentationFrameLoop(
	frame: FrameRequestCallback,
): () => void {
	let stopped = false;
	let frameHandle: number | null = null;
	let previousFrameTimeMs: number | null = null;
	const requestNextFrame = (): void => {
		// Stop may run after a frame posts this task but before the task is dispatched.
		if (!stopped) frameHandle = window.requestAnimationFrame(step);
	};
	const step = (timeMs: number): void => {
		frameHandle = null;
		if (stopped) return;
		// Repeated display timestamps have no new elapsed time. Keep scheduling, but do not
		// advance presentation or cadence consumers twice for that same timestamp.
		if (
			timeMs !== previousFrameTimeMs &&
			(document.hasFocus() ||
				previousFrameTimeMs === null ||
				timeMs - previousFrameTimeMs >= BACKGROUND_FRAME_INTERVAL_MS)
		) {
			previousFrameTimeMs = timeMs;
			frame(timeMs);
		}
		if (!stopped)
			void window.scheduler
				.postTask(requestNextFrame, { priority: "user-visible" })
				.catch((error: unknown) => window.reportError(error));
	};
	requestNextFrame();
	return () => {
		stopped = true;
		if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
		frameHandle = null;
	};
}
