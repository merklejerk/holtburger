import {
	copyFile,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { repairSettingsEntry } from "./client-settings-repair";
import { ClientSettingsStore } from "./client-settings-store";
import * as replacement from "./replace-local-file";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "../src/client/client-settings-defaults";
import { clientEnvironmentOverridesSchema } from "../src/client/client-environment-settings";
import { clientSettingsCollectionSchema } from "../src/client/client-settings-sections";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const userContext = {
	viewport: { width: 1440, height: 900 },
	shortcutCount: 8,
	platform: "windows" as const,
};

const initialWindow = {
	normalBounds: { width: 1440, height: 900 },
	maximized: false,
};
const user = createDefaultClientUserSettings(
	initialWindow.normalBounds,
	8,
	"windows",
);
const character = createDefaultClientCharacterSettings();
const directories: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture(
	userEntries: Record<string, unknown>,
	characters: Record<string, unknown> = {},
) {
	const directory = await mkdtemp(
		join(tmpdir(), "holtburger-settings-repair-"),
	);
	directories.push(directory);
	const path = join(directory, "settings.json");
	const source = JSON.stringify(
		{ formatVersion: 1, user: userEntries, characters },
		null,
		2,
	);
	await writeFile(path, source);
	const store = new ClientSettingsStore(path, initialWindow);
	await store.load();
	return { directory, path, source, store };
}

describe("persisted settings repair", () => {
	it("keeps the exact source when pruning cannot back it up, then permits a retry", async () => {
		const { store, path } = await fixture({
			audio: { version: 1, value: user.audio },
		});
		const source = JSON.stringify({
			formatVersion: 1,
			user: {
				audio: { version: 1, value: user.audio },
				unknown: { version: 1, value: true },
			},
			characters: {},
		});
		await writeFile(path, source);
		vi.mocked(copyFile).mockRejectedValueOnce(new Error("backup unavailable"));
		const patch = { sections: { audio: { ...user.audio, muted: true } } };
		await expect(store.saveUserPatch(patch)).rejects.toThrow(
			"backup unavailable",
		);
		expect(await readFile(path, "utf8")).toBe(source);
		await store.saveUserPatch(patch);
		const saved = clientSettingsCollectionSchema.parse(
			JSON.parse(await readFile(path, "utf8")),
		);
		expect(saved.user).toEqual({
			audio: { version: 1, value: patch.sections.audio },
		});
	});
	it("leaves valid reordered settings untouched, including no-op saves", async () => {
		const audio = Object.fromEntries(Object.entries(user.audio).reverse());
		const { store, path, source, directory } = await fixture({
			audio: { value: audio, version: 1 },
		});
		const loaded = await store.loadUser(userContext, "persisted");
		expect(loaded.settings.audio).toEqual(user.audio);
		await store.saveUserPatch({ sections: { audio: user.audio } });
		expect(await readFile(path, "utf8")).toBe(source);
		expect(await readdir(directory)).toEqual(["settings.json"]);
	});

	it("repairs native window settings before restoration", async () => {
		const { store } = await fixture({
			window: {
				version: 1,
				obsolete: true,
				value: {
					normalBounds: { ...initialWindow.normalBounds, x: 250, width: -1 },
					maximized: true,
				},
			},
		});
		expect(store.readWindow()).toEqual({
			normalBounds: initialWindow.normalBounds,
			maximized: true,
		});
	});

	it("fills missing fields, removes retired fields, and preserves valid nested siblings", async () => {
		const { store, path, source, directory } = await fixture({
			ui: {
				version: 1,
				value: {
					...user.ui,
					fonts: { ...user.ui.fonts, body: "mono", heading: 42 },
					retired: true,
				},
			},
			audio: {
				version: 1,
				value: { muted: true, effectVolume: 0.25, ambientVolume: 0.5 },
			},
		});
		const loaded = await store.loadUser(userContext, "persisted");
		expect(loaded.settings.ui?.fonts).toEqual({
			...user.ui.fonts,
			body: "mono",
		});
		expect(loaded.settings.audio).toEqual({
			...user.audio,
			muted: true,
			effectVolume: 0.25,
			ambientVolume: 0.5,
		});
		expect(new Set(loaded.repaired)).toEqual(
			new Set([
				"user.ui.retired: removed unknown field",
				"user.ui.fonts.heading: reset invalid value",
			]),
		);
		const backups = (await readdir(directory)).filter((name) =>
			name.includes(".backup-"),
		);
		expect(backups).toHaveLength(1);
		for (const backup of backups)
			expect(await readFile(join(directory, backup), "utf8")).toBe(source);
		const normalized = await readFile(path, "utf8");
		const reloaded = new ClientSettingsStore(path, initialWindow);
		await reloaded.load();
		expect(
			(await reloaded.loadUser(userContext, "persisted")).repaired,
		).toEqual([]);
		expect(await readFile(path, "utf8")).toBe(normalized);
		expect(await readdir(directory)).toHaveLength(2);
		await reloaded.saveUserPatch({ sections: { ui: user.ui } });
		expect(
			(await reloaded.loadUser(userContext, "persisted")).settings.ui,
		).toEqual(user.ui);
	});

	it("prunes unsupported sections and repairs supported siblings", async () => {
		const future = { version: 2, value: { future: true } };
		const { store, path } = await fixture({
			graphics: future,
			unknown: future,
			audio: "broken",
			hudPlacements: { book: future, chat: null, unknown: future },
		});
		const loaded = await store.loadUser(userContext, "persisted");
		expect(loaded.settings.audio).toEqual(user.audio);
		expect(loaded.settings.hudLayout.chat).toEqual(user.hudLayout.chat);
		const document = clientSettingsCollectionSchema.parse(
			JSON.parse(await readFile(path, "utf8")),
		);
		expect(document.user).toEqual({
			audio: { version: 1, value: user.audio },
			hudPlacements: { chat: { version: 1, value: user.hudLayout.chat } },
		});
		await store.saveUserPatch({ sections: { graphics: user.graphics } });
		expect(
			(await store.loadUser(userContext, "persisted")).settings.graphics,
		).toEqual(user.graphics);
	});

	it("repairs character collections atomically and preserves the other character", async () => {
		const other = {
			combatControls: { version: 1, value: character.combatControls },
		};
		const { store, path } = await fixture(
			{},
			{
				first: {
					combatControls: {
						version: 1,
						value: {
							...character.combatControls,
							melee: { height: "low", power: "bad" },
						},
					},
					spellBarBindings: {
						version: 1,
						value: { tabs: [["invalid spell"]] },
					},
				},
				other,
			},
		);
		const loaded = await store.loadCharacter("first", character, "persisted");
		expect(loaded.sections.combatControls?.melee).toEqual({
			height: "low",
			power: character.combatControls.melee.power,
		});
		expect(loaded.sections.spellBarBindings).toEqual(
			character.spellBarBindings,
		);
		expect(loaded.repaired).toContain(
			"character.spellBarBindings.tabs: reset invalid value",
		);
		const document = clientSettingsCollectionSchema.parse(
			JSON.parse(await readFile(path, "utf8")),
		);
		expect(document.characters.other).toEqual(other);
	});

	it("resets a coupled group when repaired fields still violate its invariant", () => {
		const schema = z
			.object({ start: z.number(), end: z.number() })
			.strict()
			.refine((value) => value.start < value.end);
		expect(
			repairSettingsEntry(
				{ version: 1, value: { start: 8, end: 2 } },
				schema,
				{ start: 0, end: 10 },
				"range",
			),
		).toEqual({
			entry: { version: 1, value: { start: 0, end: 10 } },
			notices: ["range: reset invalid value"],
		});
	});

	it("resets an invalid union branch without losing an independent override", () => {
		const weather = {
			kind: "preset",
			sourceRecordId: "0x00000001",
			sourceVersion: 0,
			dayGroupIndex: 0,
			dayGroupName: "clear",
		};
		const result = repairSettingsEntry(
			{
				version: 1,
				value: { time: { kind: "fixed", minuteOfDay: -1 }, weather },
			},
			clientEnvironmentOverridesSchema,
			user.environmentOverrides,
			"environment",
		);
		expect(result.entry).toEqual({
			version: 1,
			value: { time: user.environmentOverrides.time, weather },
		});
	});

	it("does not touch persisted settings when config is bypassed", async () => {
		const { store, path, source, directory } = await fixture({ audio: null });
		expect((await store.loadUser(userContext, "fresh")).repaired).toEqual([]);
		expect(await readFile(path, "utf8")).toBe(source);
		expect(await readdir(directory)).toEqual(["settings.json"]);
	});

	it("retains the source and reports a failed repair write; retry completes the repair", async () => {
		const { store, path, source } = await fixture({ audio: null });
		vi.spyOn(replacement, "replaceLocalFile").mockRejectedValueOnce(
			new Error("disk full"),
		);
		await expect(store.loadUser(userContext, "persisted")).rejects.toThrow(
			"disk full",
		);
		expect(await readFile(path, "utf8")).toBe(source);
		expect((await store.loadUser(userContext, "persisted")).repaired).toEqual([
			"user.audio: reset malformed entry",
		]);
	});
});
