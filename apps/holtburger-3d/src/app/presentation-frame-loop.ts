/** Maximum presentation cadence while the app window lacks focus. */
export const BACKGROUND_FRAME_INTERVAL_MS = 1_000 / 10;

/**
 * Schedule complete presentation frames, returning their lifecycle cleanup.
 *
 * Gate before any presentation work, preserving update/draw ordering. Keep requesting browser
 * frames so focus recovery takes effect on the next available frame without another event owner.
 * Browser visibility throttling remains in charge of hidden windows.
 */
export function startPresentationFrameLoop(
	frame: FrameRequestCallback,
): () => void {
	let stopped = false;
	let previousFrameTimeMs: number | null = null;
	const step = (timeMs: number): void => {
		if (stopped) return;
		if (
			document.hasFocus() ||
			previousFrameTimeMs === null ||
			timeMs - previousFrameTimeMs >= BACKGROUND_FRAME_INTERVAL_MS
		) {
			previousFrameTimeMs = timeMs;
			frame(timeMs);
		}
		if (!stopped) frameHandle = window.requestAnimationFrame(step);
	};
	let frameHandle = window.requestAnimationFrame(step);
	return () => {
		stopped = true;
		window.cancelAnimationFrame(frameHandle);
	};
}
