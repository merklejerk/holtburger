/** Frontend-owned scheduling capability; the consumer supplies its current validated cadence. */
export type StartPresentationFrameLoop = (
	frame: FrameRequestCallback,
	/** Minimum interval in milliseconds; zero admits every focused browser frame. */
	minimumFrameIntervalMs: () => number,
) => () => void;
