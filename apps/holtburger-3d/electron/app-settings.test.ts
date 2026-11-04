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
		},
	);
	it("delegates automatic graphics to Chromium and applies explicit preferences", () => {
		const automatic = commandLine([]);
		expect(
			applyAppGraphicsSettings(
				{ graphicsBackend: "automatic", vsync: true },
				automatic,
			),
		).toEqual([]);
		expect(automatic.switches.size).toBe(0);
		const selected = commandLine([]);
		applyAppGraphicsSettings(
			{ graphicsBackend: "metal", vsync: false },
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
				{ graphicsBackend: "d3d11", vsync: false },
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
			{ graphicsBackend: "automatic", vsync: true },
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
	it("retains prior preferences after a failed replacement and allows an explicit retry", async () => {
		const path = await settingsPath();
		const store = new AppSettingsStore(path, "win32");
		const original = store.settings;
		const selected = { graphicsBackend: "d3d11", vsync: true } as const;
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
		const settings = { graphicsBackend: "d3d11", vsync: false } as const;
		await store.save(settings);
		expect(new AppSettingsStore(path, "win32").settings).toEqual(settings);
		expect(() => store.save({ graphicsBackend: "metal", vsync: true })).toThrow(
			"unavailable on this platform",
		);
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
