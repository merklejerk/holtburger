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
		"browser",
		"browser",
		"The /browser route runs as a standalone scene browser.",
	);
}

export function deriveModeState(browserMode: BrowserModeState): ModeState {
	return createModeState(
		"browser",
		browserMode.destination ? browserMode.page : "browser",
		"Browser navigation is frontend-owned and destination-driven.",
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
