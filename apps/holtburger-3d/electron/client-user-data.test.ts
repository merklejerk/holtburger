import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { clientSettingsFilePath, clientUserDataPath } from "./client-user-data";

it("isolates unpackaged and packaged Electron profiles", () => {
	const config = resolve("config");
	expect(clientUserDataPath(config, "holtburger-3d", true)).toBe(
		join(config, "holtburger-3d"),
	);
	expect(clientUserDataPath(config, "holtburger-3d", false)).toBe(
		join(config, "holtburger-3d-dev"),
	);
});

it("keeps the existing settings filename in the selected global profile", () => {
	const profile = resolve("config", "holtburger-3d-dev");
	expect(clientSettingsFilePath(profile)).toBe(
		join(profile, "client-settings.json"),
	);
});
