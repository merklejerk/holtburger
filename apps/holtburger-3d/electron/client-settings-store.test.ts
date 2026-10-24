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
	CLIENT_ICON_SCALE,
	CLIENT_TEXT_SCALE,
} from "../src/client/client-settings-values";

const initialWindow = {
	normalBounds: { x: 100, y: 100, width: 1440, height: 900 },
	maximized: false,
} as const;

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
	it("evolves older graphics preferences and persists disabled ambient nameplates", async () => {
		const path = await temporarySettingsPath();
		const { alwaysShowEntityNameplates, ...olderGraphics } =
			createDefaultClientUserSettings({ width: 1440, height: 900 }, 8).graphics;
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
			expect(store.readUser("persisted")).toMatchObject({
				sections: {
					graphics: { ...savedGraphics, alwaysShowEntityNameplates },
				},
				unavailable: [],
			});
			const graphics = { ...savedGraphics, alwaysShowEntityNameplates: false };
			await store.saveUserPatch({ sections: { graphics } });
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(reloaded.readUser("persisted").sections.graphics).toEqual(
				graphics,
			);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});

	it("evolves older UI sections and restores saved text scale without changing sibling preferences", async () => {
		const path = await temporarySettingsPath();
		const fonts = { body: "serif", heading: "mono", mono: "sans" } as const;
		const vitalWarningThresholds = { health: 35, stamina: 15, mana: 25 };
		const future = { version: 4, value: { future: true } };
		try {
			await writeFile(
				path,
				JSON.stringify({
					formatVersion: 1,
					user: {
						ui: { version: 1, value: { fonts, vitalWarningThresholds } },
						future,
					},
					characters: {},
				}),
			);
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			expect(store.readUser("persisted").sections.ui).toEqual({
				fonts,
				vitalWarningThresholds,
				textScale: CLIENT_TEXT_SCALE.initial,
				iconScale: CLIENT_ICON_SCALE.initial,
			});
			const ui = {
				fonts,
				vitalWarningThresholds,
				textScale: CLIENT_TEXT_SCALE.maximum,
				iconScale: CLIENT_ICON_SCALE.minimum,
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
			expect(reloaded.readUser("persisted").sections.ui).toEqual(ui);
			expect((await readCollection(path)).user.future).toEqual(future);
			expect(() =>
				reloaded.saveUserPatch({
					sections: { ui: { ...ui, textScale: CLIENT_TEXT_SCALE.maximum + 1 } },
				}),
			).toThrow();
			expect(reloaded.readUser("persisted").sections.ui).toEqual(ui);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
	it("persists recent emotes on the user profile independently of character and server settings", async () => {
		const path = await temporarySettingsPath();
		try {
			const store = new ClientSettingsStore(path, initialWindow);
			await store.load();
			expect(store.readUser("persisted").sections.recentEmotes).toBeUndefined();
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
			expect(reloaded.readUser("persisted").sections.recentEmotes).toEqual(
				recentEmotes,
			);
			expect(reloaded.readUser("persisted").unavailable).toEqual([]);
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
				store.readCharacter(first, "persisted").sections.entityAlerts,
			).toBeUndefined();
			await store.saveCharacterPatch(first, { entityAlerts: rules });
			const reloaded = new ClientSettingsStore(path, initialWindow);
			await reloaded.load();
			expect(
				reloaded.readCharacter(first, "persisted").sections.entityAlerts,
			).toEqual(rules);
			expect(
				reloaded.readCharacter(second, "persisted").sections.entityAlerts,
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
			const read = invalid.readCharacter(first, "persisted");
			expect(read.unavailable).toHaveLength(1);
			expect(read.sections.entityAlerts).toBeUndefined();
			await invalid.saveCharacterPatch(first, { lastKnownName: "Wayfarer" });
			expect(
				(await readCollection(path)).characters[first].entityAlerts,
			).toEqual(malformed);
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
			const loaded = store.readUser("persisted");
			expect(loaded.unavailable).toEqual([]);
			expect(loaded.sections.input?.client).toEqual({
				...input.client,
				toggleChatHistory: omittedToggle,
			});
			expect(loaded.sections.chatFilters).toEqual(["combat"]);
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
				reloaded.readUser("persisted").sections.input?.client.toggleChatHistory,
			).toEqual([]);
			expect(reloaded.readUser("persisted").sections.chatFilters).toEqual([
				"combat",
			]);
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
				reloaded.readCharacter(first, "persisted").sections.actionBars,
			).toEqual(firstBars);
			expect(
				reloaded.readCharacter(second, "persisted").sections.actionBars,
			).toEqual(secondBars);
			await reloaded.saveCharacterPatch(first, {
				actionBars: bindActionCell(firstBars, address, null),
			});
			const removed = new ClientSettingsStore(path, initialWindow);
			await removed.load();
			expect(
				removed.readCharacter(first, "persisted").sections.actionBars,
			).toEqual(defaults.actionBars);
			expect(
				removed.readCharacter(second, "persisted").sections.actionBars,
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
		expect(loaded.readUser("persisted").sections.ui).toEqual(ui);
	});

	it("adds environment sections to an older profile without losing fonts or graphics", async () => {
		const path = await temporarySettingsPath();
		const defaults = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		await store.saveUserPatch({
			sections: { ui: defaults.ui, graphics: defaults.graphics },
		});
		expect(
			store.readUser("persisted").sections.environmentOverrides,
		).toBeUndefined();
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
		expect(loaded.readUser("persisted").sections).toMatchObject({
			ui: defaults.ui,
			graphics: defaults.graphics,
			clockFormat: "12-hour",
			environmentOverrides,
		});
		await loaded.saveUserPatch({
			sections: { environmentOverrides: CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT },
		});
		expect(loaded.readUser("persisted").sections.environmentOverrides).toEqual(
			CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
		);
	});
	it("round-trips the audio mix and resets it to declared defaults", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(store.readUser("persisted").sections.audio).toBeUndefined();
		const audio = {
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0.35,
			effectVolume: 0.6,
			ambientVolume: 0.2,
			muted: true,
		};
		await store.saveUserPatch({ sections: { audio } });
		const loaded = new ClientSettingsStore(path, initialWindow);
		await loaded.load();
		expect(loaded.readUser("persisted").sections.audio).toEqual(audio);
		await loaded.saveUserPatch({ sections: { audio: CLIENT_AUDIO_DEFAULTS } });
		const reset = new ClientSettingsStore(path, initialWindow);
		await reset.load();
		expect(reset.readUser("persisted").sections.audio).toEqual(
			CLIENT_AUDIO_DEFAULTS,
		);
	});
	it("loads and saves user, HUD, window, and character sections independently", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
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
		expect(loaded.readUser("persisted")).toMatchObject({
			sections: { graphics: user.graphics },
			hudPlacements: { book: user.hudLayout.book, world: user.hudLayout.world },
			unavailable: [],
		});
		expect(loaded.readUser("fresh")).toMatchObject({
			sections: {},
			hudPlacements: {},
		});
		expect(
			loaded.readCharacter("example:9000/0x50000001", "persisted"),
		).toMatchObject({
			sections: { actionBars: character.actionBars, lastKnownName: "Mira" },
			unavailable: [],
		});
		expect(loaded.readWindow()).toEqual({
			settings: initialWindow,
			unavailable: null,
		});
	});

	it("preserves unknown siblings and refuses to downgrade incompatible known sections", async () => {
		const path = await temporarySettingsPath();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const unknown = { version: 3, value: { future: [1, 2, 3] } };
		const futureInput = { version: 2, value: { changed: true } };
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					input: futureInput,
					futureUser: unknown,
					hudPlacements: {
						futurePanel: unknown,
						chat: { version: 1, value: user.hudLayout.chat },
					},
				},
				characters: {
					"example:9000/0x50000001": { futureCharacter: unknown },
				},
			}),
			"utf8",
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(store.readUser("persisted").unavailable).toContain(
			"user.input uses unsupported version 2",
		);
		await store.saveUserPatch({
			sections: { graphics: user.graphics },
			hudPlacements: { book: user.hudLayout.book, world: user.hudLayout.world },
		});
		await store.saveCharacterPatch("example:9000/0x50000001", {
			combatControls: createDefaultClientCharacterSettings().combatControls,
		});
		await expect(
			store.saveUserPatch({ sections: { input: user.input } }),
		).rejects.toThrow("user.input uses unsupported version 2");
		const document = await readCollection(path);
		expect(document.user.futureUser).toEqual(unknown);
		expect(document.user.input).toEqual(futureInput);
		expect(
			(document.user.hudPlacements as Record<string, unknown>).futurePanel,
		).toEqual(unknown);
		expect(
			document.characters["example:9000/0x50000001"].futureCharacter,
		).toEqual(unknown);
	});

	it("restores character panel geometry and saves only its placement", async () => {
		const path = await temporarySettingsPath();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const savedPanel = {
			...user.hudLayout.characterSheet,
			horizontal: { alignment: "start", offset: 73 },
			preferredWidth: 620,
		} as const;
		const futurePanel = { version: 4, value: { opaque: true } };
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: {
					hudPlacements: {
						characterSheet: { version: 1, value: savedPanel },
						book: { version: 1, value: user.hudLayout.book },
						futurePanel,
					},
				},
				characters: {},
			}),
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(store.readUser("persisted").hudPlacements.characterSheet).toEqual(
			savedPanel,
		);
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

	it("refuses newer character panel placements and preserves them during reset", async () => {
		const path = await temporarySettingsPath();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const future = { version: 2, value: { future: true } };
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: { hudPlacements: { characterSheet: future } },
				characters: {},
			}),
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		const unavailable =
			"hudPlacements.characterSheet uses unsupported version 2";
		expect(store.readUser("persisted").unavailable).toEqual([unavailable]);
		expect(
			store.readUser("persisted").hudPlacements.characterSheet,
		).toBeUndefined();
		await expect(
			store.saveUserPatch({
				hudPlacements: { characterSheet: user.hudLayout.characterSheet },
			}),
		).rejects.toThrow(unavailable);
		expect(await store.resetUser(user)).toEqual([unavailable]);
		expect((await readCollection(path)).user.hudPlacements).toMatchObject({
			characterSheet: future,
		});
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

	it("reset replaces supported values while retaining incompatible entries", async () => {
		const path = await temporarySettingsPath();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const future = { version: 2, value: { future: true } };
		await writeFile(
			path,
			JSON.stringify({
				formatVersion: 1,
				user: { input: future, hudPlacements: { book: future } },
				characters: {},
			}),
			"utf8",
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(await store.resetUser(user)).toEqual([
			"user.input uses unsupported version 2",
			"hudPlacements.book uses unsupported version 2",
		]);
		const document = await readCollection(path);
		expect(document.user.input).toEqual(future);
		expect(
			(document.user.hudPlacements as Record<string, unknown>).book,
		).toEqual(future);
		expect(document.user.graphics).toEqual({
			version: 1,
			value: user.graphics,
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
