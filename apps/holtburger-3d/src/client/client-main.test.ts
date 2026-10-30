import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TRAVELERS_KIT_THEME_ID } from "../app/ui-theme-contract";
import { createDefaultClientUserSettings } from "./client-settings-defaults";

// Vitest stubs CSS modules; the native probe verifies Vite's emitted asset URL.
vi.mock("../app/themes/travelers-kit.css?url&no-inline", () => ({
	default: "/assets/travelers-kit.css",
}));

interface StartupProps {
	mode: "client";
	startGame: (
		target: HTMLElement,
		signal: AbortSignal,
		context: Map<unknown, unknown>,
		contentLocation: string,
	) => Promise<boolean>;
}

const { mountShell, mountGame, bridge, themes, loader } = vi.hoisted(() => ({
	mountShell: vi.fn<
		(_component: unknown, props: StartupProps) => Promise<void>
	>(async () => {}),
	mountGame: vi.fn(),
	bridge: { loadUser: vi.fn(), resetUser: vi.fn() },
	themes: {
		initialIds: [],
		list: vi.fn(),
		resolve: vi.fn(),
		openDirectory: vi.fn(),
	},
	loader: { replace: vi.fn() },
}));
vi.mock("../app/mount", () => ({
	mountEntryWithProps: mountShell,
	uiThemes: loader,
}));
vi.mock("svelte", async (original) => ({
	...(await original<typeof import("svelte")>()),
	mount: mountGame,
}));
vi.mock("./ClientApp.svelte", () => ({ default: {} }));
vi.mock("../app/ContentStartup.svelte", () => ({ default: {} }));
vi.mock("./ClientShortcutDock.svelte", () => ({
	createClientShortcuts: () => [],
}));
vi.mock("./client-settings-transport", () => ({
	createElectronClientSettingsTransport: () => bridge,
}));
vi.mock("../app/ui-theme-transport", () => ({
	createElectronUiThemeTransport: () => themes,
}));
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	themes.list.mockReset().mockResolvedValue([]);
	themes.resolve.mockReset().mockResolvedValue("https://fixture/theme.css");
	loader.replace.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it("defers Client construction and composes saved HUD placements after content readiness", async () => {
	const viewport = { width: 1440, height: 900 };
	vi.stubGlobal("window", {
		holtburgerVisualCache: {
			read: vi.fn(),
			stage: vi.fn(),
			listenFailures: vi.fn(),
		},
		innerWidth: viewport.width,
		innerHeight: viewport.height,
		location: { search: "" },
	});
	const defaults = createDefaultClientUserSettings(viewport, 0);
	const inventory = { ...defaults.hudLayout.inventory, preferredWidth: 444 };
	bridge.loadUser.mockResolvedValue({
		sections: {},
		hudPlacements: { inventory },
		unavailable: [],
		repaired: [],
	});
	const entry = "./main";
	await import(entry);
	expect(mountShell).toHaveBeenCalledOnce();
	expect(bridge.loadUser).not.toHaveBeenCalled();
	expect(mountGame).not.toHaveBeenCalled();
	const call = mountShell.mock.calls.at(0);
	if (call === undefined) throw new Error("Startup shell did not mount");
	const target = {} as HTMLElement;
	expect(
		await call[1].startGame(
			target,
			new AbortController().signal,
			new Map(),
			"/selected/assets",
		),
	).toBe(true);
	expect(mountGame).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			target,
			props: expect.objectContaining({
				contentLocation: "/selected/assets",
				initialUserSettings: expect.objectContaining({
					ui: expect.objectContaining({ themeId: TRAVELERS_KIT_THEME_ID }),
					hudLayout: expect.objectContaining({
						inventory,
						journal: defaults.hudLayout.journal,
						locks: defaults.hudLayout.locks,
						partyHud: defaults.hudLayout.partyHud,
					}),
				}),
			}),
		}),
	);
	expect(loader.replace).toHaveBeenCalledWith(
		expect.stringContaining("/assets/travelers-kit.css"),
		null,
		expect.any(AbortSignal),
	);
	expect(bridge.resetUser).not.toHaveBeenCalled();
});

/** Minimal native capabilities; no renderer mount happens until bootstrap completes. */
function savedTheme(id: string) {
	const viewport = { width: 1440, height: 900 };
	vi.stubGlobal("window", {
		innerWidth: viewport.width,
		innerHeight: viewport.height,
		location: { search: "" },
		holtburgerVisualCache: {
			read: vi.fn(),
			stage: vi.fn(),
			listenFailures: vi.fn(),
		},
	});
	const defaults = createDefaultClientUserSettings(viewport, 0);
	bridge.loadUser.mockResolvedValue({
		sections: { ui: { ...defaults.ui, themeId: id } },
		hudPlacements: {},
		unavailable: [],
		repaired: [],
	});
}

async function startup() {
	const entry = "./main";
	await import(entry);
	const call = mountShell.mock.calls.at(0);
	if (call === undefined) throw new Error("Startup shell did not mount");
	return call[1];
}

it("applies the restored theme before constructing ClientApp", async () => {
	savedTheme("night");
	let release: () => void = () => {
		throw new Error("Theme gate not initialized");
	};
	themes.resolve.mockReturnValueOnce(
		new Promise<string>((resolve) => {
			release = () => resolve("https://fixture/night.css");
		}),
	);
	const shell = await startup();
	const pending = shell.startGame(
		{} as HTMLElement,
		new AbortController().signal,
		new Map(),
		"/assets",
	);
	await vi.waitFor(() => expect(themes.resolve).toHaveBeenCalledWith("night"));
	expect(mountGame).not.toHaveBeenCalled();
	release();
	expect(await pending).toBe(true);
	expect(loader.replace).toHaveBeenCalledWith(
		"https://fixture/night.css",
		null,
		expect.any(AbortSignal),
	);
	expect(mountGame).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			props: expect.objectContaining({
				initialUserSettings: expect.objectContaining({
					ui: expect.objectContaining({ themeId: "night" }),
				}),
			}),
		}),
	);
});

it("mounts with Base and a visible issue when a restored theme is missing without erasing its preference", async () => {
	savedTheme("missing");
	themes.resolve.mockRejectedValueOnce(new Error("Theme missing"));
	const shell = await startup();
	expect(
		await shell.startGame(
			{} as HTMLElement,
			new AbortController().signal,
			new Map(),
			"/assets",
		),
	).toBe(true);
	expect(loader.replace).not.toHaveBeenCalled();
	expect(mountGame).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			props: expect.objectContaining({
				initialSettingsIssue: expect.stringContaining("Theme missing"),
				initialUserSettings: expect.objectContaining({
					ui: expect.objectContaining({ themeId: "missing" }),
				}),
			}),
		}),
	);
	expect(bridge.resetUser).not.toHaveBeenCalled();
});

it("close aborts pending theme resolution before any stylesheet or client can mount", async () => {
	savedTheme("night");
	let release: () => void = () => {
		throw new Error("Theme gate not initialized");
	};
	themes.resolve.mockReturnValueOnce(
		new Promise<string>((resolve) => {
			release = () => resolve("https://fixture/late.css");
		}),
	);
	const controller = new AbortController();
	const shell = await startup();
	const pending = shell.startGame(
		{} as HTMLElement,
		controller.signal,
		new Map(),
		"/assets",
	);
	await vi.waitFor(() => expect(themes.resolve).toHaveBeenCalledOnce());
	controller.abort();
	expect(await pending).toBe(false);
	release();
	await Promise.resolve();
	expect(loader.replace).not.toHaveBeenCalled();
	expect(mountGame).not.toHaveBeenCalled();
});

it("restores the bundled alternate before mounting even when user discovery fails", async () => {
	savedTheme(TRAVELERS_KIT_THEME_ID);
	themes.list.mockRejectedValueOnce(new Error("User themes unavailable"));
	const shell = await startup();
	expect(
		await shell.startGame(
			{} as HTMLElement,
			new AbortController().signal,
			new Map(),
			"/assets",
		),
	).toBe(true);
	expect(themes.resolve).not.toHaveBeenCalled();
	expect(loader.replace).toHaveBeenCalledWith(
		expect.stringContaining("travelers-kit"),
		null,
		expect.any(AbortSignal),
	);
	expect(mountGame).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			props: expect.objectContaining({
				initialSettingsIssue: expect.stringContaining(
					"User themes unavailable",
				),
				initialUserSettings: expect.objectContaining({
					ui: expect.objectContaining({ themeId: TRAVELERS_KIT_THEME_ID }),
				}),
			}),
		}),
	);
});
