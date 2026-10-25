import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type { ClientVisualCacheTransport } from "./client-visual-cache-transport";

/** Forward cold deltas and recovery immediately; main owns write debounce and teardown. */
export function persistPlayerVisualCapture(
	event: ClientLifecycleSessionEvent,
	transport: ClientVisualCacheTransport,
	reportFailure: (message: string) => void,
): Promise<void> | null {
	const capture =
		event.type === "player-visual-capture"
			? event.capture
			: event.type === "current-state"
				? event.state.playerVisualCapture
				: null;
	if (capture === null) return null;
	const staging = transport.stage(capture);
	void staging.catch((error: unknown) =>
		reportFailure(
			`Character appearance could not be saved: ${error instanceof Error ? error.message : String(error)}`,
		),
	);
	return staging;
}
