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
				sections: {},
				hudPlacements: {},
				unavailable: [],
			}),
			saveUserPatch: async () => undefined,
			resetUser: async () => [],
			loadCharacter: async () => ({ sections: {}, unavailable: [] }),
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
				sections: { graphics: user.graphics },
				hudPlacements: { book: user.hudLayout.book },
				unavailable: ["user.input uses unsupported version 2"],
			}),
			loadCharacter: async () => ({
				sections: {
					combatControls: character.combatControls,
					lastKnownName: "Mira",
				},
				unavailable: [],
			}),
		});
		const transport = createElectronClientSettingsTransport();
		expect(await transport.loadUser()).toEqual({
			sections: { graphics: user.graphics },
			hudPlacements: { book: user.hudLayout.book },
			unavailable: ["user.input uses unsupported version 2"],
		});
		expect(await transport.loadCharacter(7)).toEqual({
			sections: {
				combatControls: character.combatControls,
				lastKnownName: "Mira",
			},
			unavailable: [],
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
			createElectronClientSettingsTransport().loadUser(),
		).rejects.toThrow("Malformed user settings response");
		installBridge({
			loadCharacter: async () => ({
				sections: { lastKnownName: 42 },
				unavailable: [],
			}),
		});
		await expect(
			createElectronClientSettingsTransport().loadCharacter(7),
		).rejects.toThrow("Malformed character settings response");
	});
});
