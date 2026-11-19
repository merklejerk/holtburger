import { afterEach, expect, it, vi } from "vitest";
import { createElectronUiThemeTransport } from "./ui-theme-transport";

afterEach(() => vi.unstubAllGlobals());

it("validates native discovery and resource URLs without exposing arbitrary path access", async () => {
	const list = vi.fn(async () => ["Midnight 雪"]);
	const resolve = vi.fn(
		async () =>
			"holtburger-theme://local/Midnight%20%E9%9B%AA/generation/theme.css",
	);
	const openDirectory = vi.fn(async () => {});
	vi.stubGlobal("window", {
		holtburgerThemes: { list, resolve, openDirectory },
	});
	const transport = createElectronUiThemeTransport();
	expect(await transport.list()).toEqual(["Midnight 雪"]);
	expect(await transport.resolve("Midnight 雪")).toContain(
		"holtburger-theme://local/",
	);
	await transport.openDirectory();
	expect(openDirectory).toHaveBeenCalledOnce();
	await expect(transport.resolve("../outside")).rejects.toThrow();
	expect(resolve).toHaveBeenCalledTimes(1);
	list.mockResolvedValueOnce(["../outside"]);
	await expect(transport.list()).rejects.toThrow();
	resolve.mockResolvedValueOnce("file:///outside/theme.css");
	await expect(transport.resolve("Midnight 雪")).rejects.toThrow(
		"Invalid theme resource URL",
	);
});

it("requires the desktop capability rather than silently providing an empty catalog", () => {
	vi.stubGlobal("window", {});
	expect(() => createElectronUiThemeTransport()).toThrow(
		"Electron theme bridge is unavailable",
	);
});
