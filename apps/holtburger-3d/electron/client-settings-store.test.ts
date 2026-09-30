import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClientSettingsStore } from "./client-settings-store";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "../src/client/client-settings-defaults";
import { clientSettingsCollectionSchema } from "../src/client/client-settings-sections";

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
			hudPlacements: { book: user.hudLayout.book },
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
			hudPlacements: { book: user.hudLayout.book },
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
			hudPlacements: { book: user.hudLayout.book },
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
		const collidingTemporaryPath = `${path}.tmp-${process.pid}-1`;
		await writeFile(collidingTemporaryPath, "occupied", "utf8");
		await expect(
			store.saveUserPatch({ sections: { ui: user.ui } }),
		).rejects.toMatchObject({ code: "EEXIST" });
		expect(await readFile(path, "utf8")).toBe(before);
		await unlink(collidingTemporaryPath);
		await store.saveUserPatch({ sections: { ui: user.ui } });
		expect((await readCollection(path)).user.ui).toEqual({
			version: 1,
			value: user.ui,
		});
	});
});
