import { expect, it } from "vitest";
import { clientSettingsFilePath, clientUserDataPath } from "./client-user-data";

it("isolates unpackaged and packaged Electron profiles", () => {
	expect(clientUserDataPath("/config", "holtburger-3d", true)).toBe(
		"/config/holtburger-3d",
	);
	expect(clientUserDataPath("/config", "holtburger-3d", false)).toBe(
		"/config/holtburger-3d-dev",
	);
});

it("keeps the existing settings filename in the selected global profile", () => {
	expect(clientSettingsFilePath("/config/holtburger-3d-dev")).toBe(
		"/config/holtburger-3d-dev/client-settings.json",
	);
});
