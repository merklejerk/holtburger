import { describe, expect, it } from "vitest";
import { SPELL_BAR_INDICES } from "./client-spell-bar-state";
import {
	clientCharacterSettingsSchema,
	clientUserSettingsSchema,
} from "./client-settings-contract";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "./client-settings-defaults";
import { hudTrayOrientation, rotateHudTray } from "./client-hud-tray-layout";

const viewport = { width: 1440, height: 900 };

describe("current client settings values", () => {
	it("validates complete runtime user and character settings", () => {
		const user = createDefaultClientUserSettings(viewport, 8);
		const character = createDefaultClientCharacterSettings();
		expect(clientUserSettingsSchema.parse(user)).toEqual(user);
		expect(clientCharacterSettingsSchema.parse(character)).toEqual(character);
	});

	it("keeps the status tray orientation invariant", () => {
		const user = createDefaultClientUserSettings(viewport, 8);
		const rotated = rotateHudTray(user.hudLayout.statusTray);
		expect(hudTrayOrientation(rotated)).not.toBe(
			hudTrayOrientation(user.hudLayout.statusTray),
		);
		expect(
			clientUserSettingsSchema.parse({
				...user,
				hudLayout: { ...user.hudLayout, statusTray: rotated },
			}).hudLayout.statusTray,
		).toEqual(rotated);
		expect(() =>
			clientUserSettingsSchema.parse({
				...user,
				hudLayout: {
					...user.hudLayout,
					statusTray: {
						...user.hudLayout.statusTray,
						preferredWidth: user.hudLayout.statusTray.preferredHeight,
					},
				},
			}),
		).toThrow("status tray needs positive dimensions");
	});

	it("rejects unknown fields and invalid fixed collections", () => {
		const user = createDefaultClientUserSettings(viewport, 8);
		const character = createDefaultClientCharacterSettings();
		expect(() =>
			clientUserSettingsSchema.parse({ ...user, extra: true }),
		).toThrow();
		expect(() =>
			clientUserSettingsSchema.parse({
				...user,
				chatFilters: ["combat", "chat"],
			}),
		).toThrow();
		expect(() =>
			clientCharacterSettingsSchema.parse({
				...character,
				actionBars: [character.actionBars[0], character.actionBars[0]],
			}),
		).toThrow("action bar identities must be unique");
		expect(() =>
			clientCharacterSettingsSchema.parse({
				...character,
				spellBarBindings: {
					tabs: character.spellBarBindings.tabs.slice(0, 9),
				},
			}),
		).toThrow();
	});

	it("normalizes spell tabs while preserving occupied overflow cells", () => {
		const character = createDefaultClientCharacterSettings();
		const tabs = [...character.spellBarBindings.tabs];
		tabs[0] = [...SPELL_BAR_INDICES.map(() => 1), 2, null, null];
		const parsed = clientCharacterSettingsSchema.parse({
			...character,
			spellBarBindings: { tabs },
		});
		expect(parsed.spellBarBindings.tabs[0]).toEqual([
			...SPELL_BAR_INDICES.map(() => 1),
			2,
			null,
		]);
	});
});
