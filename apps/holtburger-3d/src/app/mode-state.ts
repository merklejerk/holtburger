import type { LifecycleStateDto } from "../lib/host/contracts";
import type { BrowserModeState } from "./browser-mode";
import { availableModes, type AppModeId } from "./modes";

export interface ModeState {
	activeMode: AppModeId;
	activeModeLabel: string;
	activePageId: string;
	routingReason: string;
}

export function createInitialModeState(): ModeState {
	return createModeState(
		"client",
		"world-viewer",
		"The app runs as a Tauri-backed world viewer; plain browser preview is intentionally unsupported.",
	);
}

export function deriveModeState(
	lifecycleState: LifecycleStateDto | null,
	browserMode: BrowserModeState,
): ModeState {
	return createModeState(
		"client",
		browserMode.destination ? browserMode.page : "world-viewer",
		lifecycleState?.phase === "ready" &&
			lifecycleState.sessionState === "connected"
			? "The host lifecycle reports a ready connected client session, so the world viewer is live."
			: "The app stays in one world-viewer mode; navigation overlays can change focus without becoming a separate app mode.",
	);
}

function createModeState(
	activeMode: AppModeId,
	activePageId: string,
	routingReason: string,
): ModeState {
	const activeModeLabel =
		availableModes.find((mode) => mode.id === activeMode)?.label ??
		"Unknown Mode";

	return {
		activeMode,
		activeModeLabel,
		activePageId,
		routingReason,
	};
}
