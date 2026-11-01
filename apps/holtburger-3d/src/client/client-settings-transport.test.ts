import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "./client-settings-defaults";
import { createElectronClientSettingsTransport } from "./client-settings-transport";

function installBridge(overrides: Record<string, unknown> = {}): void {
	vi.stubGlobal("window", {
		holtburgerSettings: {
			loadUser: async () => ({
				settings: createDefaultClientUserSettings(
					{ width: 1440, height: 900 },
					8,
				),
				repaired: [],
			}),
			saveUserPatch: async () => undefined,
			resetUser: async () => undefined,
			loadCharacter: async () => ({
				sections: {},
				repaired: [],
			}),
			saveCharacterPatch: async () => undefined,
			...overrides,
		},
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("Electron client settings transport", () => {
	it("publishes independently validated user and character sections", async () => {
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const character = createDefaultClientCharacterSettings();
		installBridge({
			loadUser: async () => ({
				settings: user,
				repaired: [],
			}),
			loadCharacter: async () => ({
				sections: {
					combatControls: character.combatControls,
					lastKnownName: "Mira",
				},
				repaired: [],
			}),
		});
		const transport = createElectronClientSettingsTransport();
		expect(
			await transport.loadUser({
				viewport: { width: 1440, height: 900 },
				shortcutCount: 8,
			}),
		).toEqual({
			settings: user,
			repaired: [],
		});
		expect(await transport.loadCharacter(7)).toEqual({
			sections: {
				combatControls: character.combatControls,
				lastKnownName: "Mira",
			},
			repaired: [],
		});
	});

	it("validates scoped saves before sending them through preload", async () => {
		const saveUserPatch = vi.fn(async () => undefined);
		const saveCharacterPatch = vi.fn(async () => undefined);
		installBridge({ saveUserPatch, saveCharacterPatch });
		const transport = createElectronClientSettingsTransport();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		await transport.saveUserPatch({
			hudPlacements: { book: user.hudLayout.book },
		});
		expect(saveUserPatch).toHaveBeenCalledWith({
			hudPlacements: { book: user.hudLayout.book },
		});
		const character = createDefaultClientCharacterSettings();
		await transport.saveCharacterPatch(7, {
			combatControls: character.combatControls,
		});
		expect(saveCharacterPatch).toHaveBeenCalledWith(7, {
			combatControls: character.combatControls,
		});
		expect(() =>
			transport.saveUserPatch({
				sections: { chatFilters: ["combat", "chat"] },
			}),
		).toThrow();
	});

	it("rejects malformed preload responses", async () => {
		installBridge({ loadUser: async () => ({ sections: { graphics: {} } }) });
		await expect(
			createElectronClientSettingsTransport().loadUser({
				viewport: { width: 1440, height: 900 },
				shortcutCount: 8,
			}),
		).rejects.toThrow("Malformed user settings response");
		installBridge({
			loadCharacter: async () => ({
				sections: { lastKnownName: 42 },
				repaired: [],
			}),
		});
		await expect(
			createElectronClientSettingsTransport().loadCharacter(7),
		).rejects.toThrow("Malformed character settings response");
	});
});
