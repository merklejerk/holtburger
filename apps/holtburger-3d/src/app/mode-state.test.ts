import { describe, expect, it } from "vitest";

import { createBrowserModeState } from "./browser-mode";
import { deriveModeState } from "./mode-state";

describe("mode state derivation", () => {
	it("keeps the app in world viewer mode without a destination override", () => {
		const state = deriveModeState(
			{
				phase: "ready",
				activeModeHint: "client",
				sessionState: "connected",
			},
			{
				...createBrowserModeState(),
				destination: null,
				page: "location-entry",
			},
		);

		expect(state.activeMode).toBe("client");
		expect(state.activePageId).toBe("world-viewer");
	});

	it("uses the browser page while a destination override is active", () => {
		const state = deriveModeState(null, createBrowserModeState());

		expect(state.activeMode).toBe("client");
		expect(state.activePageId).toBe("destination-preview");
	});
});
