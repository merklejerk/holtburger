import { CLIENT_PANEL_SHORTCUT_ACTIONS } from "../lib/input/input-contract";
import { describe, expect, it } from "vitest";
import { SPELL_BAR_INDICES } from "./client-spell-bar-state";
import {
	clientAudioSettingsSchema,
	clientUiSettingsSchema,
	clientCharacterSettingsSchema,
	clientUserSettingsSchema,
} from "./client-settings-contract";
import {
	CLIENT_AUDIO_DEFAULTS,
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "./client-settings-defaults";
import { hudTrayOrientation, rotateHudTray } from "./client-hud-tray-layout";
import {
	CLIENT_KEYBOARD_DEFAULTS,
	clientKeyboardSettingsSchema,
} from "./client-input-settings";

import {
	CLIENT_VITAL_WARNING_PERCENT,
	CLIENT_VITAL_WARNING_THRESHOLDS,
} from "./client-settings-values";

const viewport = { width: 1440, height: 900 };

describe("current client settings values", () => {
	it("adds panel defaults to old profiles and preserves remapped and unbound panels", () => {
		const olderClient = Object.fromEntries(
			Object.entries(CLIENT_KEYBOARD_DEFAULTS.client).filter(
				([action]) =>
					!CLIENT_PANEL_SHORTCUT_ACTIONS.some((panel) => panel === action),
			),
		);
		const previous = { ...CLIENT_KEYBOARD_DEFAULTS, client: olderClient };
		expect(clientKeyboardSettingsSchema.parse(previous)).toEqual(
			CLIENT_KEYBOARD_DEFAULTS,
		);
		const client = {
			...olderClient,
			toggleInventory: [],
			toggleCharacter: [{ key: "F8" }],
		};
		const loaded = clientKeyboardSettingsSchema.parse({ ...previous, client });
		expect(loaded.client).toEqual({
			...CLIENT_KEYBOARD_DEFAULTS.client,
			...client,
		});
	});

	it("fills the missing history toggle while preserving saved alternatives and unbound choices", () => {
		const { toggleChatHistory, ...olderClient } =
			CLIENT_KEYBOARD_DEFAULTS.client;
		const previous = {
			...CLIENT_KEYBOARD_DEFAULTS,
			client: { ...olderClient, examine: [{ key: "F9" }] },
		};
		expect(clientKeyboardSettingsSchema.parse(previous).client).toEqual({
			...previous.client,
			toggleChatHistory,
		});
		for (const binding of [[], [{ key: "F10", ctrl: true }]]) {
			expect(
				clientKeyboardSettingsSchema.parse({
					...previous,
					client: { ...previous.client, toggleChatHistory: binding },
				}).client.toggleChatHistory,
			).toEqual(binding);
		}
	});
	it("adds warning thresholds to older UI profiles while preserving font choices", () => {
		const fonts = { body: "serif", heading: "sans", mono: "mono" } as const;
		expect(clientUiSettingsSchema.parse({ fonts })).toEqual({
			fonts,
			vitalWarningThresholds: CLIENT_VITAL_WARNING_THRESHOLDS,
		});
	});
	it.each(["health", "stamina", "mana"] as const)(
		"validates and preserves the %s threshold",
		(kind) => {
			const fonts = { body: "theme", heading: "theme", mono: "theme" } as const;
			for (const value of [
				CLIENT_VITAL_WARNING_PERCENT.minimum - 1,
				CLIENT_VITAL_WARNING_PERCENT.maximum + 1,
				12.5,
				NaN,
				Infinity,
			]) {
				expect(
					clientUiSettingsSchema.safeParse({
						fonts,
						vitalWarningThresholds: {
							...CLIENT_VITAL_WARNING_THRESHOLDS,
							[kind]: value,
						},
					}).success,
				).toBe(false);
			}
			const vitalWarningThresholds = { health: 35, stamina: 15, mana: 25 };
			expect(
				clientUiSettingsSchema.parse({ fonts, vitalWarningThresholds })
					.vitalWarningThresholds,
			).toEqual(vitalWarningThresholds);
		},
	);
	it("adds split-stack to older keyboard maps while retaining customized keys", () => {
		const { splitStack, ...olderClient } = CLIENT_KEYBOARD_DEFAULTS.client;
		const previous = {
			...CLIENT_KEYBOARD_DEFAULTS,
			client: { ...olderClient, examine: [{ key: "F9" }] },
		};
		expect(clientKeyboardSettingsSchema.parse(previous).client).toEqual({
			...previous.client,
			splitStack,
		});
		for (const binding of [[], [{ key: "F10", ctrl: true }]]) {
			expect(
				clientKeyboardSettingsSchema.parse({
					...previous,
					client: { ...previous.client, splitStack: binding },
				}).client.splitStack,
			).toEqual(binding);
		}
	});
	it("adds independent power defaults to older maps and preserves saved power alternatives", () => {
		const { preciseJump, ...older } = CLIENT_KEYBOARD_DEFAULTS;
		expect(clientKeyboardSettingsSchema.parse(older).preciseJump).toEqual(
			preciseJump,
		);
		const remapped = { increasePower: [{ key: "i" }], decreasePower: [] };
		expect(
			clientKeyboardSettingsSchema.parse({ ...older, preciseJump: remapped })
				.preciseJump,
		).toEqual(remapped);
	});
	it("loads saved keyboard maps while preserving current remapped controls", () => {
		const current = createDefaultClientUserSettings(viewport, 8).input;
		const examine = [{ key: "F8" }];
		const forward = [{ key: "i" }];
		const saved = {
			...current,
			character: { ...current.character, forward },
			client: {
				...current.client,
				examine,
				preciseJumpPowerUp: [{ key: "]" }],
				preciseJumpPowerDown: [{ key: "[" }],
			},
		};
		const loaded = clientKeyboardSettingsSchema.parse(saved);
		expect(loaded.client).toEqual({ ...current.client, examine });
		expect(loaded.character).toEqual({ ...current.character, forward });
	});

	it("uses the declared initial audio mix", () => {
		expect(createDefaultClientUserSettings(viewport, 8).audio).toEqual(
			CLIENT_AUDIO_DEFAULTS,
		);
	});
	it.each(["masterVolume", "effectVolume", "ambientVolume"] as const)(
		"validates %s independently",
		(key) => {
			for (const invalid of [NaN, Infinity, -0.01, 1.01]) {
				expect(() =>
					clientAudioSettingsSchema.parse({
						...CLIENT_AUDIO_DEFAULTS,
						[key]: invalid,
					}),
				).toThrow();
			}
			expect(
				clientAudioSettingsSchema.parse({ ...CLIENT_AUDIO_DEFAULTS, [key]: 0 })[
					key
				],
			).toBe(0);
		},
	);
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
