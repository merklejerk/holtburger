import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import * as replacement from "./replace-local-file";
import { ClientSettingsStore } from "./client-settings-store";
import {
	CLIENT_AUDIO_DEFAULTS,
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "../src/client/client-settings-defaults";
import { clientSettingsCollectionSchema } from "../src/client/client-settings-sections";
import {
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
	MINUTES_PER_GAME_DAY,
} from "../src/client/client-environment-settings";
import { clientEnvironmentFixture } from "../src/client/client-environment.test-support";
import { clientWeatherPresets } from "../src/client/client-environment";

import { EQUIPMENT_SLOTS } from "../src/client/client-inventory-equipment";
import { loadoutActionContentSchema } from "../src/client/client-loadout";
import { bindActionCell } from "../src/client/client-action-bar-state";
import {
	CLIENT_UI_SCALE,
	CLIENT_HUD_WINDOW_OPACITY,
	CLIENT_DEFAULT_THEME_ID,
	CLIENT_TEXT_SCALE,
} from "../src/client/client-settings-values";

const userContext = {
	viewport: { width: 1440, height: 900 },
	shortcutCount: 8,
	platform: "windows" as const,
};

const initialWindow = {
	normalBounds: { width: 1440, height: 900 },
	maximized: false,
	borderless: false,
	fullscreen: false,
	freeResize: true,
} as const;

const defaultUser = createDefaultClientUserSettings(
	initialWindow.normalBounds,
	8,
	"windows",
);
const defaultCharacter = createDefaultClientCharacterSettings();

async function temporarySettingsPath(): Promise<string> {
	return join(
		await mkdtemp(join(tmpdir(), "holtburger-settings-")),
		"settings.json",
	);
}

async function readCollection(path: string) {
	return clientSettingsCollectionSchema.parse(
		JSON.parse(await readFile(path, "utf8")),
	);
}

describe("ClientSettingsStore", () => {
	it.each(["mac", "windows", "linux", "unknown"] as const)(
		"uses %s input defaults for fresh, absent, and incomplete settings",
		async (platform) => {
			const path = await temporarySettingsPath();
			const context = { ...userContext, platform };
			const defaults = createDefaultClientUserSettings(
				context.viewport,
				context.shortcutCount,
				platform,
			);
			try {
				const store = new ClientSettingsStore(path, initialWindow);
				await store.load();
				for (const mode of ["fresh", "persisted"] as const)
					expect((await store.loadUser(context, mode)).settings.input).toEqual(
						defaults.input,
					);
				const { holdChatHistory: omitted, ...client } = defaults.input.client;
				await writeFile(
					path,
					JSON.stringify({
						formatVersion: 1,
						user: {
							input: {
								version: 1,
								value: {
									...defaults.input,
									client: { ...client, examine: [{ key: "F12" }] },
								},
							},
						},
						characters: {},
					}),
				);
				const reloaded = new ClientSettingsStore(path, initialWindow);
				await reloaded.load();
				const result = await reloaded.loadUser(context, "persisted");
				expect(result.settings.input.client.holdChatHistory).toEqual(omitted);
				expect(result.settings.input.client.examine).toEqual([{ key: "F12" }]);
			} finally {
				await rm(dirname(path), { recursive: true, force: true });
			}
		},
	);
	it.each(["absent", "malformed"] as const)(
		"resolves %s placement defaults after restoring scale and preserves valid anchors",
		async (kind) => {
			const path = await temporarySettingsPath();
			const ui = { ...defaultUser.ui, uiScale: CLIENT_UI_SCALE.maximum };
			const placements = {
				inventory: { version: 1, value: defaultUser.hudLayout.inventory },
				...(kind === "malformed"
					? { chat: { version: 1, value: "broken" } }
					: {}),
			};
			await writeFile(
				path,
				JSON.stringify({
					formatVersion: 1,
					user: { ui: { version: 1, value: ui }, hudPlacements: placements },
					characters: {},
				}),
			);
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			const loaded = await store.loadUser(userContext, "persisted");
			const logicalDefaults = createDefaultClientUserSettings(
				{
					width: userContext.viewport.width / ui.uiScale,
					height: userContext.viewport.height / ui.uiScale,
				},
				userContext.shortcutCount,
				"windows",
			);
			expect(loaded.settings.hudLayout.chat).toEqual(
				logicalDefaults.hudLayout.chat,
			);
			expect(loaded.settings.hudLayout.inventory).toEqual(
				defaultUser.hudLayout.inventory,
			);
			const before = (await readCollection(path)).user.hudPlacements;
			await store.saveUserPatch({
				sections: { ui: { ...ui, uiScale: CLIENT_UI_SCALE.minimum } },
			});
			expect((await readCollection(path)).user.hudPlacements).toEqual(before);
			if (kind === "malformed")
				expect(before).toMatchObject({
					chat: { version: 1, value: logicalDefaults.hudLayout.chat },
				});
		},
	);

	it("normalizes a retired UI preference without losing customized typography", async () => {
		const path = await temporarySettingsPath();
		const fonts = { body: "mono", heading: "serif", mono: "sans" } as const;
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					ui: {
						version: 1,
						value: {
							...defaultUser.ui,
							uiScale: undefined,
							iconScale: 1.75,
							fonts,
						},
					},
				},
				characters: {},
			}),
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		const result = await store.loadUser(userContext, "persisted");
		expect(result.settings.ui).toEqual({ ...defaultUser.ui, fonts });
		await store.saveUserPatch({
			sections: {
				ui: { ...result.settings.ui, uiScale: CLIENT_UI_SCALE.maximum },
			},
		});
		expect(
			(await store.loadUser(userContext, "persisted")).settings.ui,
		).toEqual({ ...defaultUser.ui, fonts, uiScale: CLIENT_UI_SCALE.maximum });
	});
	it.each([false, true])(
		"persists explicit automatic-key choice %s across reloads",
		async (autoUseKeys) => {
			const path = await temporarySettingsPath();
			try {
				const store = new ClientSettingsStore(path, initialWindow);
				await store.load();
				await store.saveUserPatch({
					sections: { lockInteractions: { autoUseKeys } },
				});
				const reloaded = new ClientSettingsStore(path, initialWindow);
				await reloaded.load();
				expect(await reloaded.loadUser(userContext, "persisted")).toMatchObject(
					{
						settings: { lockInteractions: { autoUseKeys } },
						repaired: [],
					},
				);
			} finally {
				await rm(dirname(path), { recursive: true, force: true });
			}
		},
	);

	it("defaults chat timestamps on and retains user-wide chat choices across reloads", async () => {
		const path = await temporarySettingsPath();
		try {
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			const initial = await store.loadUser(userContext, "persisted");
			expect({ ...defaultUser, ...initial.settings }.chatTimestamps).toBe(true);
			for (const chatTimestamps of [false, true]) {
				const chatChannelFilters = {
					...defaultUser.chatChannelFilters,
					general: chatTimestamps,
					allegiance: false,
					society: false,
				};
				await store.saveUserPatch({
					sections: {
						chatTimestamps,
						chatFilters: ["combat"],
						chatChannelFilters,
					},
				});
				const reloaded = new ClientSettingsStore(path, initialWindow);
				await reloaded.load();
				expect(await reloaded.loadUser(userContext, "persisted")).toMatchObject(
					{
						settings: {
							chatTimestamps,
							chatFilters: ["combat"],
							chatChannelFilters,
						},
						repaired: [],
					},
				);
			}
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});

	it("defaults chat suppression on for old profiles and persists explicit opt-outs", async () => {
		const path = await temporarySettingsPath();
		try {
			await writeFile(
				path,
				JSON.stringify({
					formatVersion: 1,
					user: { chatFilters: { version: 1, value: ["chat"] } },
					characters: {},
				}),
			);
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			const loaded = await store.loadUser(userContext, "persisted");
			expect(loaded.repaired).toEqual([]);
			// Startup composes absent sections from first-run defaults.
			expect({ ...defaultUser, ...loaded.settings }).toMatchObject({
				chatSuppression: {
					hideSelfEvasionsAndResists: true,
					hideSpellIncantations: true,
				},
				chatFilters: ["chat"],
			});
			const chatSuppression = {
				hideSelfEvasionsAndResists: false,
				hideSpellIncantations: false,
			};
			await store.saveUserPatch({ sections: { chatSuppression } });
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(await reloaded.loadUser(userContext, "persisted")).toMatchObject({
				settings: { chatSuppression, chatFilters: ["chat"] },
				repaired: [],
			});
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});

	it("evolves older graphics preferences and persists disabled ambient nameplates", async () => {
		const path = await temporarySettingsPath();
		const { alwaysShowEntityNameplates, ...olderGraphics } =
			createDefaultClientUserSettings(
				{ width: 1440, height: 900 },
				8,
				"windows",
			).graphics;
		const savedGraphics = { ...olderGraphics, weatherEnabled: false };
		try {
			await writeFile(
				path,
				JSON.stringify({
					formatVersion: 1,
					user: { graphics: { version: 1, value: savedGraphics } },
					characters: {},
				}),
			);
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			expect(await store.loadUser(userContext, "persisted")).toMatchObject({
				settings: {
					graphics: { ...savedGraphics, alwaysShowEntityNameplates },
				},
				repaired: [],
			});
			const graphics = { ...savedGraphics, alwaysShowEntityNameplates: false };
			await store.saveUserPatch({ sections: { graphics } });
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				(await reloaded.loadUser(userContext, "persisted")).settings.graphics,
			).toEqual(graphics);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});

	it("evolves older UI sections and retains theme selection, scales, and sibling preferences", async () => {
		const path = await temporarySettingsPath();
		const fonts = { body: "serif", heading: "mono", mono: "sans" } as const;
		const vitalWarningThresholds = { health: 35, stamina: 15, mana: 25 };
		try {
			await writeFile(
				path,
				JSON.stringify({
					formatVersion: 1,
					user: {
						ui: { version: 1, value: { fonts, vitalWarningThresholds } },
					},
					characters: {},
				}),
			);
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			expect(
				(await store.loadUser(userContext, "persisted")).settings.ui,
			).toEqual({
				themeId: CLIENT_DEFAULT_THEME_ID,
				showFps: false,
				showHelpLabels: true,
				useUnlockHelper: true,
				fonts,
				vitalWarningThresholds,
				textScale: CLIENT_TEXT_SCALE.initial,
				uiScale: CLIENT_UI_SCALE.initial,
				hudWindowOpacity: CLIENT_HUD_WINDOW_OPACITY.initial,
			});
			const ui = {
				themeId: "Midnight 雪",
				showFps: true,
				showHelpLabels: false,
				useUnlockHelper: false,
				fonts,
				vitalWarningThresholds,
				textScale: CLIENT_TEXT_SCALE.maximum,
				uiScale: CLIENT_UI_SCALE.minimum,
				hudWindowOpacity: CLIENT_HUD_WINDOW_OPACITY.maximum,
			};
			await store.saveUserPatch({ sections: { ui } });
			await store.saveCharacterPatch("example:9000/0x50000001", {
				lastKnownName: "First",
			});
			await store.saveCharacterPatch("example:9000/0x50000002", {
				lastKnownName: "Second",
			});
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				(await reloaded.loadUser(userContext, "persisted")).settings.ui,
			).toEqual(ui);
			expect(() =>
				reloaded.saveUserPatch({
					sections: { ui: { ...ui, textScale: CLIENT_TEXT_SCALE.maximum + 1 } },
				}),
			).toThrow();
			expect(
				(await reloaded.loadUser(userContext, "persisted")).settings.ui,
			).toEqual(ui);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
	it("persists recent emotes on the user profile independently of character and server settings", async () => {
		const path = await temporarySettingsPath();
		try {
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			expect(
				(await store.loadUser(userContext, "persisted")).settings.recentEmotes,
			).toEqual(defaultUser.recentEmotes);
			const recentEmotes = ["wave", "bowdeepstate"];
			await store.saveUserPatch({ sections: { recentEmotes } });
			await store.saveCharacterPatch("first:9000/0x50000001", {
				lastKnownName: "First",
			});
			await store.saveCharacterPatch("second:9000/0x50000002", {
				lastKnownName: "Second",
			});
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				(await reloaded.loadUser(userContext, "persisted")).settings
					.recentEmotes,
			).toEqual(recentEmotes);
			const saved = await readCollection(path);
			expect(saved.user.recentEmotes).toEqual({
				version: 1,
				value: recentEmotes,
			});
			for (const character of Object.values(saved.characters))
				expect(character).not.toHaveProperty("recentEmotes");
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});

	it("persists entity alerts per character and leaves missing or malformed older sections explicit", async () => {
		const path = await temporarySettingsPath();
		const first = "fixture:9000/0x50000001";
		const second = "fixture:9000/0x50000002";
		const rules = [
			{
				id: "golems",
				enabled: true,
				match: { mode: "glob" as const, pattern: "*Golem*" },
			},
		];
		try {
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			expect(
				(await store.loadCharacter(first, defaultCharacter, "persisted"))
					.sections.entityAlerts,
			).toBeUndefined();
			await store.saveCharacterPatch(first, { entityAlerts: rules });
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				(await reloaded.loadCharacter(first, defaultCharacter, "persisted"))
					.sections.entityAlerts,
			).toEqual(rules);
			expect(
				(await reloaded.loadCharacter(second, defaultCharacter, "persisted"))
					.sections.entityAlerts,
			).toBeUndefined();
			const saved = await readCollection(path);
			const malformed = {
				version: 1,
				value: [
					{
						id: "broken",
						enabled: true,
						match: { mode: "glob", pattern: "bad\\" },
					},
				],
			};
			await writeFile(
				path,
				JSON.stringify({
					...saved,
					characters: {
						...saved.characters,
						[first]: { ...saved.characters[first], entityAlerts: malformed },
					},
				}),
			);
			const invalid = new ClientSettingsStore(path, initialWindow);
			await invalid.load();
			const read = await invalid.loadCharacter(
				first,
				defaultCharacter,
				"persisted",
			);
			expect(read.repaired).toEqual([
				"character.entityAlerts: reset invalid value",
			]);
			expect(read.sections.entityAlerts).toEqual(defaultCharacter.entityAlerts);
			await invalid.saveCharacterPatch(first, { lastKnownName: "Wayfarer" });
			expect(
				(await readCollection(path)).characters[first].entityAlerts,
			).toEqual({ version: 1, value: defaultCharacter.entityAlerts });
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
	it("loads older keyboard maps with the chat toggle while preserving remaps, unbound actions and filters", async () => {
		const path = await temporarySettingsPath();
		try {
			const defaults = createDefaultClientUserSettings(
				{ width: 1440, height: 900 },
				8,
				"windows",
			);
			const { toggleChatHistory: omittedToggle, ...oldClient } =
				defaults.input.client;
			const input = {
				...defaults.input,
				client: { ...oldClient, chat: [], splitStack: [{ key: "F6" }] },
			};
			await writeFile(
				path,
				JSON.stringify({
					formatVersion: 1,
					user: {
						input: { version: 1, value: input },
						chatFilters: { version: 1, value: ["combat"] },
					},
					characters: {},
				}),
			);
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			const loaded = await store.loadUser(userContext, "persisted");
			expect(loaded.repaired).toEqual([]);
			expect(loaded.settings.input?.client).toEqual({
				...input.client,
				toggleChatHistory: omittedToggle,
			});
			expect(loaded.settings.chatFilters).toEqual(["combat"]);
			await store.saveUserPatch({
				sections: {
					input: {
						...defaults.input,
						client: { ...input.client, toggleChatHistory: [] },
					},
				},
			});
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				(await reloaded.loadUser(userContext, "persisted")).settings.input
					?.client.toggleChatHistory,
			).toEqual([]);
			expect(
				(await reloaded.loadUser(userContext, "persisted")).settings
					.chatFilters,
			).toEqual(["combat"]);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
	it("reloads character-scoped loadouts and persists cell deletion independently", async () => {
		const path = await temporarySettingsPath();
		try {
			const defaults = createDefaultClientCharacterSettings();
			const slot = EQUIPMENT_SLOTS[0];
			if (slot === undefined) throw new Error("Equipment fixture needs a slot");
			const saved = loadoutActionContentSchema.parse({
				kind: "loadout",
				name: "Travel",
				icon: "❤️",
				bindings: [
					{ slot: slot.mask, item: 91, name: "Missing item name" },
					{ slot: EQUIPMENT_SLOTS[1].mask, item: null, name: null },
				],
			});
			const address = { bar: defaults.actionBars[0].id, slot: 0 } as const;
			const first = "example:9000/0x50000001";
			const second = "example:9000/0x50000002";
			const firstBars = bindActionCell(defaults.actionBars, address, saved);
			const secondBars = bindActionCell(defaults.actionBars, address, {
				...saved,
				name: "Combat",
			});
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			await store.saveCharacterPatch(first, { actionBars: firstBars });
			await store.saveCharacterPatch(second, { actionBars: secondBars });
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				(await reloaded.loadCharacter(first, defaultCharacter, "persisted"))
					.sections.actionBars,
			).toEqual(firstBars);
			expect(
				(await reloaded.loadCharacter(second, defaultCharacter, "persisted"))
					.sections.actionBars,
			).toEqual(secondBars);
			await reloaded.saveCharacterPatch(first, {
				actionBars: bindActionCell(firstBars, address, null),
			});
			const removed = new ClientSettingsStore(path, initialWindow);
			await removed.load();
			expect(
				(await removed.loadCharacter(first, defaultCharacter, "persisted"))
					.sections.actionBars,
			).toEqual(defaults.actionBars);
			expect(
				(await removed.loadCharacter(second, defaultCharacter, "persisted"))
					.sections.actionBars,
			).toEqual(secondBars);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});

	it("persists independent vital warning thresholds in the existing UI section", async () => {
		const path = await temporarySettingsPath();
		const defaults = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
			"windows",
		);
		const ui = {
			...defaults.ui,
			vitalWarningThresholds: { health: 35, stamina: 15, mana: 25 },
		};
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		await store.saveUserPatch({ sections: { ui } });
		const loaded = new ClientSettingsStore(path, initialWindow);
		await loaded.load();
		expect(
			(await loaded.loadUser(userContext, "persisted")).settings.ui,
		).toEqual(ui);
	});

	it("adds environment sections to an older profile without losing fonts or graphics", async () => {
		const path = await temporarySettingsPath();
		const defaults = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
			"windows",
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		await store.saveUserPatch({
			sections: { ui: defaults.ui, graphics: defaults.graphics },
		});
		expect(
			(await store.loadUser(userContext, "persisted")).settings
				.environmentOverrides,
		).toEqual(CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT);
		const preset = clientWeatherPresets(clientEnvironmentFixture())[0];
		if (preset === undefined) throw new Error("Fixture preset missing.");
		const environmentOverrides = {
			time: { kind: "fixed" as const, minuteOfDay: MINUTES_PER_GAME_DAY / 2 },
			weather: preset.choice,
		};
		await store.saveUserPatch({
			sections: { clockFormat: "12-hour", environmentOverrides },
		});
		const loaded = new ClientSettingsStore(path, initialWindow);
		await loaded.load();
		expect(
			(await loaded.loadUser(userContext, "persisted")).settings,
		).toMatchObject({
			ui: defaults.ui,
			graphics: defaults.graphics,
			clockFormat: "12-hour",
			environmentOverrides,
		});
		await loaded.saveUserPatch({
			sections: { environmentOverrides: CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT },
		});
		expect(
			(await loaded.loadUser(userContext, "persisted")).settings
				.environmentOverrides,
		).toEqual(CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT);
	});
	it("round-trips the audio mix and resets it to declared defaults", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(
			(await store.loadUser(userContext, "persisted")).settings.audio,
		).toEqual(CLIENT_AUDIO_DEFAULTS);
		const audio = {
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0.35,
			musicVolume: 0.45,
			effectVolume: 0.6,
			ambientVolume: 0.2,
			muted: true,
		};
		await store.saveUserPatch({ sections: { audio } });
		const loaded = new ClientSettingsStore(path, initialWindow);
		await loaded.load();
		expect(
			(await loaded.loadUser(userContext, "persisted")).settings.audio,
		).toEqual(audio);
		await loaded.saveUserPatch({ sections: { audio: CLIENT_AUDIO_DEFAULTS } });
		const reset = new ClientSettingsStore(path, initialWindow);
		await reset.load();
		expect(
			(await reset.loadUser(userContext, "persisted")).settings.audio,
		).toEqual(CLIENT_AUDIO_DEFAULTS);
	});
	it("loads and saves user, HUD, window, and character sections independently", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
			"windows",
		);
		const character = createDefaultClientCharacterSettings();
		await store.saveUserPatch({
			sections: { graphics: user.graphics },
			hudPlacements: { book: user.hudLayout.book, world: user.hudLayout.world },
		});
		await store.saveCharacterPatch("example:9000/0x50000001", {
			actionBars: character.actionBars,
			lastKnownName: " Mira ",
		});
		await store.updateWindow(initialWindow);

		const loaded = new ClientSettingsStore(path, initialWindow);
		await loaded.load();
		expect(await loaded.loadUser(userContext, "persisted")).toMatchObject({
			settings: {
				graphics: user.graphics,
				hudLayout: { book: user.hudLayout.book, world: user.hudLayout.world },
			},
			repaired: [],
		});
		expect(await loaded.loadUser(userContext, "fresh")).toEqual({
			settings: defaultUser,
			repaired: [],
		});
		expect(
			await loaded.loadCharacter(
				"example:9000/0x50000001",
				defaultCharacter,
				"persisted",
			),
		).toMatchObject({
			sections: { actionBars: character.actionBars, lastKnownName: "Mira" },
		});
		expect(loaded.readWindow()).toEqual(initialWindow);
	});

	it("prunes all profile sections before restoring supported settings", async () => {
		const path = await temporarySettingsPath();
		const future = { version: 2, value: { changed: true } };
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					window: future,
					input: future,
					futureUser: future,
					hudPlacements: {
						futurePanel: future,
						book: future,
						chat: { version: 1, value: defaultUser.hudLayout.chat },
					},
				},
				characters: {
					first: { futureCharacter: future, combatControls: future },
					second: {
						lastKnownName: { version: 1, value: "Wayfarer" },
						unknown: future,
					},
				},
			}),
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(await readCollection(path)).toEqual({
			formatVersion: 1,
			user: {
				hudPlacements: {
					chat: { version: 1, value: defaultUser.hudLayout.chat },
				},
			},
			characters: {
				first: {},
				second: { lastKnownName: { version: 1, value: "Wayfarer" } },
			},
		});
		await store.saveUserPatch({ sections: { input: defaultUser.input } });
		await store.saveCharacterPatch("first", {
			combatControls: defaultCharacter.combatControls,
		});
		expect((await readCollection(path)).user.input).toEqual({
			version: 1,
			value: defaultUser.input,
		});
		expect(
			(await readCollection(path)).characters.first.combatControls,
		).toEqual({ version: 1, value: defaultCharacter.combatControls });
	});

	it("restores character panel geometry and saves only its placement", async () => {
		const path = await temporarySettingsPath();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
			"windows",
		);
		const savedPanel = {
			...user.hudLayout.characterSheet,
			horizontal: { alignment: "start", offset: 73 },
			preferredWidth: 620,
		} as const;
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					hudPlacements: {
						characterSheet: { version: 1, value: savedPanel },
						book: { version: 1, value: user.hudLayout.book },
					},
				},
				characters: {},
			}),
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(
			(await store.loadUser(userContext, "persisted")).settings.hudLayout
				.characterSheet,
		).toEqual(savedPanel);
		const before = await readCollection(path);
		const resizedPanel = { ...savedPanel, preferredHeight: 640 };
		await store.saveUserPatch({
			hudPlacements: { characterSheet: resizedPanel },
		});
		expect(await readCollection(path)).toEqual({
			...before,
			user: {
				...before.user,
				hudPlacements: {
					...(before.user.hudPlacements as Record<string, unknown>),
					characterSheet: { version: 1, value: resizedPanel },
				},
			},
		});
	});

	it("can reset a pruned placement to a supported value", async () => {
		const path = await temporarySettingsPath();
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					hudPlacements: { characterSheet: { version: 2, value: {} } },
				},
				characters: {},
			}),
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		await store.resetUser(defaultUser);
		expect((await readCollection(path)).user.hudPlacements).toEqual(
			Object.fromEntries(
				Object.entries(defaultUser.hudLayout).map(([key, value]) => [
					key,
					{ version: 1, value },
				]),
			),
		);
	});

	it("re-reads the file for sequential saves from separate store instances", async () => {
		const path = await temporarySettingsPath();
		const first = new ClientSettingsStore(path, initialWindow);
		const second = new ClientSettingsStore(path, initialWindow);
		await first.load();
		await second.load();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
			"windows",
		);
		await first.saveUserPatch({ sections: { graphics: user.graphics } });
		await second.saveUserPatch({ sections: { ui: user.ui } });
		const document = await readCollection(path);
		expect(document.user.graphics).toEqual({
			version: 1,
			value: user.graphics,
		});
		expect(document.user.ui).toEqual({ version: 1, value: user.ui });
	});

	it("normalizes unsupported sections introduced after startup during a later patch", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					input: { version: 2, value: {} },
					unknown: { version: 1, value: null },
				},
				characters: { inactive: { future: { version: 2, value: null } } },
			}),
		);
		await store.saveUserPatch({ sections: { audio: defaultUser.audio } });
		expect(await readCollection(path)).toEqual({
			formatVersion: 1,
			user: { audio: { version: 1, value: defaultUser.audio } },
			characters: { inactive: {} },
		});
	});

	it("does not change invalid or legacy source files", async () => {
		const path = await temporarySettingsPath();
		await writeFile(path, "{not json", "utf8");
		await expect(
			new ClientSettingsStore(path, initialWindow).load(),
		).rejects.toThrow(path);
		expect(await readFile(path, "utf8")).toBe("{not json");
		const legacy = JSON.stringify({
			schemaVersion: 13,
			user: {},
			characters: {},
		});
		await writeFile(path, legacy, "utf8");
		await expect(
			new ClientSettingsStore(path, initialWindow).load(),
		).rejects.toThrow("convert this file to the collection format");
		expect(await readFile(path, "utf8")).toBe(legacy);
	});

	it("keeps the previous document when an atomic replacement fails", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
			"windows",
		);
		await store.saveUserPatch({ sections: { graphics: user.graphics } });
		const before = await readFile(path, "utf8");
		const failure = vi
			.spyOn(replacement, "replaceLocalFile")
			.mockRejectedValueOnce(new Error("disk full"));
		await expect(
			store.saveUserPatch({ sections: { ui: user.ui } }),
		).rejects.toThrow("disk full");
		expect(await readFile(path, "utf8")).toBe(before);
		failure.mockRestore();
		await store.saveUserPatch({ sections: { ui: user.ui } });
		expect((await readCollection(path)).user.ui).toEqual({
			version: 1,
			value: user.ui,
		});
	});
});
