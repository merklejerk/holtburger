import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "./client-settings-defaults";
import { createElectronClientSettingsTransport } from "./client-settings-transport";

function installBridge(overrides: Record<string, unknown> = {}): void {
	vi.stubGlobal("window", {
		holtburgerSettings: {
			loadUser: async () => ({ kind: "missing" }),
			saveUser: async () => undefined,
			loadCharacter: async () => ({ kind: "missing" }),
			saveCharacter: async () => undefined,
			...overrides,
		},
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("Electron client settings transport", () => {
	it("publishes validated user and character responses", async () => {
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const character = createDefaultClientCharacterSettings();
		installBridge({
			loadUser: async () => ({ kind: "loaded", settings: user }),
			loadCharacter: async () => ({
				kind: "loaded",
				settings: character,
				lastKnownName: "Mira",
			}),
		});
		const transport = createElectronClientSettingsTransport();

		expect(await transport.loadUser()).toEqual({
			kind: "loaded",
			settings: user,
		});
		expect(await transport.loadCharacter(7)).toEqual({
			kind: "loaded",
			settings: character,
			lastKnownName: "Mira",
		});
	});

	it("rejects malformed preload responses", async () => {
		installBridge({ loadUser: async () => ({ kind: "loaded", settings: {} }) });
		await expect(
			createElectronClientSettingsTransport().loadUser(),
		).rejects.toThrow();

		installBridge({
			loadCharacter: async () => ({
				kind: "loaded",
				settings: createDefaultClientCharacterSettings(),
				lastKnownName: 42,
			}),
		});
		await expect(
			createElectronClientSettingsTransport().loadCharacter(7),
		).rejects.toThrow("Malformed character settings response");

		installBridge({
			loadUser: async () => ({ kind: "missing", unexpected: true }),
		});
		await expect(
			createElectronClientSettingsTransport().loadUser(),
		).rejects.toThrow("Malformed user settings response");
	});
});
