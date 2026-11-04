import { describe, expect, it } from "vitest";

import { applicationMenuTemplate } from "./application-menu.js";

describe("application menu policy", () => {
	it("installs native macOS app, editing, and window commands", () => {
		expect(applicationMenuTemplate("darwin")).toEqual([
			{ role: "appMenu" },
			{ role: "editMenu" },
			{ role: "windowMenu" },
		]);
	});

	it.each(["linux", "win32"] as const)(
		"suppresses the window menu on %s",
		(platform) => {
			expect(applicationMenuTemplate(platform)).toBeNull();
		},
	);
});
