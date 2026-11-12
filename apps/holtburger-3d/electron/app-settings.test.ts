import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AppSettingsStore,
	applyAppGraphicsSettings,
	appSettingsRequireRestart,
	graphicsBackendOptions,
} from "./app-settings";

const directories: string[] = [];
async function settingsPath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "h3d-app-settings-"));
	directories.push(directory);
	return join(directory, "app-settings.json");
}
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

/** Models Electron's switches without requiring a GPU or Electron process in unit tests. */
function commandLine(initial: readonly [string, string][]) {
	const switches = new Map(initial);
	return {
		switches,
		hasSwitch: (name: string) => switches.has(name),
		appendSwitch: (name: string, value = "") => {
			switches.set(name, value);
		},
		removeSwitch: (name: string) => {
			switches.delete(name);
		},
	};
}

describe("app graphics startup", () => {
	it.each(["win32", "darwin", "linux"] as const)(
		"preserves established %s startup behavior through platform defaults",
		async (platform) => {
			const store = new AppSettingsStore(await settingsPath(), platform);
			const startup = commandLine([]);
			applyAppGraphicsSettings(store.settings, startup);
			if (platform === "win32") {
				expect(startup.switches.get("use-angle")).toBe("gl");
				expect(startup.switches.has("disable-gpu-vsync")).toBe(true);
			} else {
				expect(startup.switches.size).toBe(0);
			}
			expect(startup.switches.has("disable-gpu-compositing")).toBe(
				!store.defaults.gpuCompositing,
			);
		},
	);
	it("applies compositing preferences, preserves launch overrides, and requires restart", () => {
		const enabled = {
			graphicsBackend: "automatic",
			vsync: true,
			gpuCompositing: true,
		} as const;
		const disabled = { ...enabled, gpuCompositing: false };
		const startup = commandLine([]);
		expect(applyAppGraphicsSettings(disabled, startup)).toEqual([]);
		expect(startup.switches.has("disable-gpu-compositing")).toBe(true);
		const overridden = commandLine([["disable-gpu-compositing", ""]]);
		expect(applyAppGraphicsSettings(enabled, overridden)).toEqual([
			"--disable-gpu-compositing",
		]);
		expect(overridden.switches.has("disable-gpu-compositing")).toBe(true);
		expect(appSettingsRequireRestart(enabled, disabled)).toBe(true);
		expect(appSettingsRequireRestart(disabled, enabled)).toBe(true);
		expect(appSettingsRequireRestart(disabled, disabled)).toBe(false);
	});
	it("delegates automatic graphics to Chromium and applies explicit preferences", () => {
		const automatic = commandLine([]);
		expect(
			applyAppGraphicsSettings(
				{ graphicsBackend: "automatic", vsync: true, gpuCompositing: true },
				automatic,
			),
		).toEqual([]);
		expect(automatic.switches.size).toBe(0);
		const selected = commandLine([]);
		applyAppGraphicsSettings(
			{ graphicsBackend: "metal", vsync: false, gpuCompositing: true },
			selected,
		);
		expect(selected.switches.get("use-angle")).toBe("metal");
		expect(selected.switches.has("disable-gpu-vsync")).toBe(true);
	});
	it("preserves diagnostic overrides and lets enable-vsync defeat every disable path", () => {
		const native = commandLine([
			["use-angle", "swiftshader"],
			["disable-frame-rate-limit", ""],
			["disable-gpu-vsync", ""],
			["enable-vsync", ""],
		]);
		expect(
			applyAppGraphicsSettings(
				{ graphicsBackend: "d3d11", vsync: false, gpuCompositing: true },
				native,
			),
		).toContain("--use-angle");
		expect(native.switches.get("use-angle")).toBe("swiftshader");
		expect(native.switches.has("disable-frame-rate-limit")).toBe(false);
		expect(native.switches.has("disable-gpu-vsync")).toBe(false);
		const uncapped = commandLine([
			["disable-frame-rate-limit", ""],
			["disable-gpu-vsync", ""],
		]);
		applyAppGraphicsSettings(
			{ graphicsBackend: "automatic", vsync: true, gpuCompositing: true },
			uncapped,
		);
		expect(uncapped.switches.has("disable-gpu-vsync")).toBe(true);
	});
	it("offers only platform-appropriate backends", () => {
		expect(graphicsBackendOptions("win32").map(({ value }) => value)).toEqual([
			"automatic",
			"d3d11",
			"gl",
		]);
		expect(graphicsBackendOptions("darwin").map(({ value }) => value)).toEqual([
			"automatic",
			"metal",
		]);
		expect(graphicsBackendOptions("linux").map(({ value }) => value)).toEqual([
			"automatic",
			"gl",
		]);
	});
});

describe("app settings persistence", () => {
	it.each(["win32", "darwin", "linux"] as const)(
		"adds the %s compositing default to older preferences without resetting other choices",
		async (platform) => {
			const path = await settingsPath();
			const previous = { graphicsBackend: "automatic", vsync: false };
			await writeFile(path, JSON.stringify({ version: 1, settings: previous }));
			const store = new AppSettingsStore(path, platform);
			expect(store.diagnostic).toBeNull();
			expect(store.settings).toEqual({
				...previous,
				gpuCompositing: store.defaults.gpuCompositing,
			});
			await store.save(store.settings);
			expect(new AppSettingsStore(path, platform).settings).toEqual(
				store.settings,
			);
		},
	);
	it("retains prior preferences after a failed replacement and allows an explicit retry", async () => {
		const path = await settingsPath();
		const store = new AppSettingsStore(path, "win32");
		const original = store.settings;
		const selected = {
			graphicsBackend: "d3d11",
			vsync: true,
			gpuCompositing: true,
		} as const;
		await mkdir(path);
		await expect(store.save(selected)).rejects.toThrow();
		await expect(store.flush()).rejects.toThrow();
		expect(store.settings).toEqual(original);
		await rm(path, { recursive: true });
		await store.save(selected);
		await store.flush();
		expect(new AppSettingsStore(path, "win32").settings).toEqual(selected);
	});
	it("loads defaults on first launch and durably saves choices for the next process", async () => {
		const path = await settingsPath();
		const store = new AppSettingsStore(path, "win32");
		expect(store.settings).toEqual(store.defaults);
		expect(store.diagnostic).toBeNull();
		const settings = {
			graphicsBackend: "d3d11",
			vsync: false,
			gpuCompositing: true,
		} as const;
		await store.save(settings);
		expect(new AppSettingsStore(path, "win32").settings).toEqual(settings);
		expect(() =>
			store.save({
				graphicsBackend: "metal",
				vsync: true,
				gpuCompositing: true,
			}),
		).toThrow("unavailable on this platform");
		expect(store.settings).toEqual(settings);
	});
	it("reports malformed preferences and preserves the original on explicit repair", async () => {
		const path = await settingsPath();
		await writeFile(path, "broken settings");
		const store = new AppSettingsStore(path, "darwin");
		expect(store.diagnostic).toContain("could not be loaded");
		expect(store.settings).toEqual(store.defaults);
		await store.save(store.defaults);
		const directory = dirname(path);
		const backup = (await readdir(directory)).find((name) =>
			name.includes(".invalid-"),
		);
		if (backup === undefined)
			throw new Error("Missing preserved settings file");
		expect(await readFile(join(directory, backup), "utf8")).toBe(
			"broken settings",
		);
		expect(store.diagnostic).toBeNull();
	});
});
