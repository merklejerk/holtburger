import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClientSettingsStore } from "./client-settings-store";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "../src/client/client-settings-defaults";
import { parseClientLocalSettingsDocument } from "../src/client/client-settings-contract";
import { SPELL_BAR_INDICES } from "../src/client/client-spell-bar-state";

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

describe("ClientSettingsStore", () => {
	it("reports absence and refuses character writes before user bootstrap", async () => {
		const store = new ClientSettingsStore(
			await temporarySettingsPath(),
			initialWindow,
		);
		await store.load();
		expect(store.readUser("persisted")).toEqual({ kind: "missing" });
		expect(() =>
			store.saveCharacter(
				"example:9000/0x50000001",
				createDefaultClientCharacterSettings(),
				null,
			),
		).toThrow("before user bootstrap");
	});

	it("atomically retains ordered user, window, and character mutations", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const character = createDefaultClientCharacterSettings();
		const writes = [
			store.saveUser(user),
			store.updateWindow({
				normalBounds: { x: 20, y: 30, width: 1200, height: 800 },
				maximized: true,
			}),
			store.saveCharacter("example:9000/0x50000001", character, " Example "),
		];
		await Promise.all(writes);
		await store.flush();

		const decoded = parseClientLocalSettingsDocument(
			JSON.parse(await readFile(path, "utf8")),
		);
		expect(decoded.user.client).toEqual(user);
		expect(decoded.user.window).toEqual({
			normalBounds: { x: 20, y: 30, width: 1200, height: 800 },
			maximized: true,
		});
		expect(decoded.characters["example:9000/0x50000001"]).toEqual({
			lastKnownName: "Example",
			settings: character,
		});
	});

	it("persists and reloads spell tabs with overflow cells", async () => {
		const path = await temporarySettingsPath();
		const profileKey = "example:9000/0x50000001";
		const store = new ClientSettingsStore(path, initialWindow);
		await store.saveUser(
			createDefaultClientUserSettings({ width: 1440, height: 900 }, 8),
		);
		const defaults = createDefaultClientCharacterSettings();
		const tabs = [...defaults.spellBarBindings.tabs];
		tabs[0] = [...SPELL_BAR_INDICES.map((slot) => slot + 1), 11, null];
		await store.saveCharacter(
			profileKey,
			{ ...defaults, spellBarBindings: { tabs } },
			null,
		);
		const reloaded = new ClientSettingsStore(path, initialWindow);
		await reloaded.load();
		const profile = reloaded.readCharacter(profileKey, "persisted");
		expect(profile.kind).toBe("loaded");
		if (profile.kind !== "loaded") throw new Error("Expected saved character");
		expect(profile.settings.spellBarBindings.tabs[0]).toEqual(tabs[0]);
	});

	it("loads a complete document without changing it", async () => {
		const path = await temporarySettingsPath();
		const user = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const source = {
			schemaVersion: 11,
			user: { window: initialWindow, client: user },
			characters: {},
		};
		await writeFile(path, JSON.stringify(source), "utf8");
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		expect(store.readUser("persisted")).toEqual({
			kind: "loaded",
			settings: user,
		});
		expect(store.readWindow()).toEqual(initialWindow);
	});

	it("can treat persisted client profiles as fresh without disabling overwrites", async () => {
		const path = await temporarySettingsPath();
		const originalUser = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		const originalCharacter = createDefaultClientCharacterSettings();
		await writeFile(
			path,
			JSON.stringify({
				schemaVersion: 11,
				user: { window: initialWindow, client: originalUser },
				characters: {
					"example:9000/0x50000001": {
						lastKnownName: "Original",
						settings: originalCharacter,
					},
				},
			}),
			"utf8",
		);
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();

		expect(store.readUser("fresh")).toEqual({ kind: "missing" });
		expect(store.readCharacter("example:9000/0x50000001", "fresh")).toEqual({
			kind: "missing",
		});

		const replacementUser = {
			...originalUser,
			graphics: {
				...originalUser.graphics,
				weatherEnabled: !originalUser.graphics.weatherEnabled,
			},
		};
		const replacementCharacter = {
			...originalCharacter,
			actionBars: [
				{
					...originalCharacter.actionBars[0]!,
					orientation: "vertical" as const,
				},
			],
		};
		await store.saveUser(replacementUser);
		await store.saveCharacter(
			"example:9000/0x50000001",
			replacementCharacter,
			"Replacement",
		);

		expect(store.readUser("persisted")).toEqual({
			kind: "loaded",
			settings: replacementUser,
		});
		expect(store.readUser("fresh")).toEqual({
			kind: "loaded",
			settings: replacementUser,
		});
		expect(store.readCharacter("example:9000/0x50000001", "persisted")).toEqual(
			{
				kind: "loaded",
				settings: replacementCharacter,
				lastKnownName: "Replacement",
			},
		);
		expect(store.readCharacter("example:9000/0x50000001", "fresh")).toEqual({
			kind: "loaded",
			settings: replacementCharacter,
			lastKnownName: "Replacement",
		});
	});

	it("keeps the previous document when an atomic replacement fails", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();
		const first = createDefaultClientUserSettings(
			{ width: 1440, height: 900 },
			8,
		);
		await store.saveUser(first);
		const firstDocument = await readFile(path, "utf8");

		const collidingTemporaryPath = `${path}.tmp-${process.pid}-1`;
		await writeFile(collidingTemporaryPath, "occupied", "utf8");
		const second = {
			...first,
			graphics: {
				...first.graphics,
				weatherEnabled: !first.graphics.weatherEnabled,
			},
		};
		await expect(store.saveUser(second)).rejects.toMatchObject({
			code: "EEXIST",
		});
		expect(await readFile(path, "utf8")).toBe(firstDocument);

		await unlink(collidingTemporaryPath);
		await store.saveUser(second);
		expect(
			parseClientLocalSettingsDocument(JSON.parse(await readFile(path, "utf8")))
				.user.client,
		).toEqual(second);
	});

	it("preserves an invalid file and reports its path", async () => {
		const path = await temporarySettingsPath();
		await writeFile(path, "{not json", "utf8");
		const store = new ClientSettingsStore(path, initialWindow);
		await expect(store.load()).rejects.toThrow(path);
		expect(await readFile(path, "utf8")).toBe("{not json");
	});
});
