import { describe, expect, it } from "vitest";

import { createBrowserModeState } from "./browser-mode";
import { deriveModeState } from "./mode-state";

describe("mode state derivation", () => {
	it("keeps the app in browser mode without a destination override", () => {
		const state = deriveModeState({
			...createBrowserModeState(),
			destination: null,
			page: "location-entry",
		});

		expect(state.activeMode).toBe("browser");
		expect(state.activePageId).toBe("browser");
	});

	it("uses the browser page while a destination override is active", () => {
		const state = deriveModeState(createBrowserModeState());

		expect(state.activeMode).toBe("browser");
		expect(state.activePageId).toBe("destination-preview");
	});
});
