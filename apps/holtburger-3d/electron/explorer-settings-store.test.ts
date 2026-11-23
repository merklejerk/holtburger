import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClientSettingsStore } from "./client-settings-store";
import {
	createDefaultExplorerHudLayout,
	EXPLORER_INPUT_DEFAULTS,
	EXPLORER_WORLD_DEFAULTS,
} from "../src/explorer/settings/explorer-settings-defaults";
import { createDefaultClientUserSettings } from "../src/client/settings/settings-defaults";

const directories: string[] = [];

async function temporarySettingsPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "h3d-explorer-settings-"));
	directories.push(dir);
	return join(dir, "client-settings.json");
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

const initialWindow = {
	normalBounds: { width: 1280, height: 720 },
	maximized: false,
	fullscreen: false,
	borderless: false,
	freeResize: true,
};

const clientContext = {
	platform: "linux" as const,
	viewport: { width: 1280, height: 720 },
	shortcutCount: 6,
};

const explorerContext = {
	platform: "linux" as const,
};

describe("Explorer settings persistence and Client isolation", () => {
	it("round-trips Explorer launcher, graphics, world, input, and HUD placements across reloads", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();

		const launcherPrefs = {
			contentPath: "/dats/ac",
			weenieCatalogPath: "/dats/weenies.hwc",
			initialLocation: "0xA9B4FFFF",
		};
		await store.saveExplorerLauncher(launcherPrefs);

		const loaded = await store.loadExplorerUser(explorerContext, "persisted");
		expect(loaded.repaired).toEqual([]);
		expect(loaded.settings.explorerWorld.interestFollowsCamera).toBe(true);

		const nextGraphics = {
			...loaded.settings.graphics,
			verticalFovDegrees: 90,
			weatherEnabled: false,
		};
		const nextWorld = {
			...loaded.settings.explorerWorld,
			flySpeed: 320,
			interestFollowsCamera: false,
		};
		const nextScenePlacement = {
			...loaded.settings.explorerHudLayout.scene,
			preferredWidth: 410,
		};

		await store.saveExplorerUserPatch({
			sections: {
				graphics: nextGraphics,
				explorerWorld: nextWorld,
			},
			explorerHudPlacements: {
				scene: nextScenePlacement,
			},
		});

		const reloaded = new ClientSettingsStore(path, initialWindow);
		await reloaded.load();
		expect(await reloaded.loadExplorerLauncher()).toEqual(launcherPrefs);
		const reloadedUser = await reloaded.loadExplorerUser(
			explorerContext,
			"persisted",
		);
		expect(reloadedUser.repaired).toEqual([]);
		expect(reloadedUser.settings.graphics.verticalFovDegrees).toBe(90);
		expect(reloadedUser.settings.graphics.weatherEnabled).toBe(false);
		expect(reloadedUser.settings.explorerWorld.flySpeed).toBe(320);
		expect(reloadedUser.settings.explorerWorld.interestFollowsCamera).toBe(
			false,
		);
		expect(reloadedUser.settings.explorerHudLayout.scene.preferredWidth).toBe(
			410,
		);
	});

	it("shares graphics, ui, audio, and input sections live between Client and Explorer without clobbering mode-owned sections", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();

		const clientInitial = await store.loadUser(clientContext, "persisted");
		await store.saveUserPatch({
			sections: {
				graphics: {
					...clientInitial.settings.graphics,
					verticalFovDegrees: 62,
				},
				audio: {
					...clientInitial.settings.audio,
					masterVolume: 0.42,
					muted: true,
				},
			},
		});

		const explorerLoaded = await store.loadExplorerUser(
			explorerContext,
			"persisted",
		);
		expect(explorerLoaded.settings.audio.masterVolume).toBe(0.42);
		expect(explorerLoaded.settings.audio.muted).toBe(true);
		expect(explorerLoaded.settings.graphics.verticalFovDegrees).toBe(62);

		await store.saveExplorerUserPatch({
			sections: {
				ui: {
					...explorerLoaded.settings.ui,
					uiScale: 1.25,
				},
				graphics: {
					...explorerLoaded.settings.graphics,
					verticalFovDegrees: 95,
				},
			},
		});

		const clientReloaded = await store.loadUser(clientContext, "persisted");
		expect(clientReloaded.settings.ui.uiScale).toBe(1.25);
		expect(clientReloaded.settings.graphics.verticalFovDegrees).toBe(95);
	});

	it("keeps Client resetUser and Explorer resetExplorerUser mutually non-clobbering", async () => {
		const path = await temporarySettingsPath();
		const store = new ClientSettingsStore(path, initialWindow);
		await store.load();

		await store.saveExplorerLauncher({
			contentPath: "/custom/dats",
			weenieCatalogPath: "/custom/weenies.hwc",
			initialLocation: "Holtburg",
		});
		const clientLoaded = await store.loadUser(clientContext, "persisted");
		const explorerLoaded = await store.loadExplorerUser(
			explorerContext,
			"persisted",
		);

		await store.saveUserPatch({
			sections: {
				graphics: {
					...clientLoaded.settings.graphics,
					verticalFovDegrees: 64,
				},
				audio: {
					...clientLoaded.settings.audio,
					masterVolume: 0.55,
				},
			},
		});
		await store.saveExplorerUserPatch({
			sections: {
				explorerWorld: {
					...explorerLoaded.settings.explorerWorld,
					flySpeed: 400,
				},
			},
		});

		// Reset Client settings: Explorer sections & launcher must survive untouched.
		await store.resetUser(
			createDefaultClientUserSettings(
				clientContext.viewport,
				clientContext.shortcutCount,
				clientContext.platform,
			),
		);
		expect((await store.loadExplorerLauncher()).contentPath).toBe(
			"/custom/dats",
		);
		expect(
			(await store.loadExplorerUser(explorerContext, "persisted")).settings
				.explorerWorld.flySpeed,
		).toBe(400);

		// Customize Client graphics + shared audio again, then reset Explorer settings.
		await store.saveUserPatch({
			sections: {
				graphics: {
					...clientLoaded.settings.graphics,
					verticalFovDegrees: 68,
				},
				audio: {
					...clientLoaded.settings.audio,
					masterVolume: 0.77,
				},
			},
		});
		await store.resetExplorerUser({
			explorerWorld: EXPLORER_WORLD_DEFAULTS,
			explorerInput: EXPLORER_INPUT_DEFAULTS,
			explorerHudLayout: createDefaultExplorerHudLayout(),
		});

		const afterExplorerResetClient = await store.loadUser(
			clientContext,
			"persisted",
		);
		expect(afterExplorerResetClient.settings.graphics.verticalFovDegrees).toBe(
			68,
		);
		expect(afterExplorerResetClient.settings.audio.masterVolume).toBe(0.77);
		expect((await store.loadExplorerLauncher()).contentPath).toBe(
			"/custom/dats",
		);
		expect(
			(await store.loadExplorerUser(explorerContext, "persisted")).settings
				.explorerWorld.flySpeed,
		).toBe(EXPLORER_WORLD_DEFAULTS.flySpeed);
	});
});
