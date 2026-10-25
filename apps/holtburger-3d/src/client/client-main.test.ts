import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultClientUserSettings } from "./client-settings-defaults";

interface StartupProps {
	mode: "client";
	startGame: (
		target: HTMLElement,
		isClosing: () => boolean,
		context: Map<unknown, unknown>,
		contentLocation: string,
	) => Promise<boolean>;
}

const { mountShell, mountGame, bridge } = vi.hoisted(() => ({
	mountShell: vi.fn<
		(_component: unknown, props: StartupProps) => Promise<void>
	>(async () => {}),
	mountGame: vi.fn(),
	bridge: { loadUser: vi.fn(), resetUser: vi.fn() },
}));
vi.mock("../app/mount", () => ({ mountEntryWithProps: mountShell }));
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
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
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
		await call[1].startGame(target, () => false, new Map(), "/selected/assets"),
	).toBe(true);
	expect(mountGame).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			target,
			props: expect.objectContaining({
				contentLocation: "/selected/assets",
				initialUserSettings: expect.objectContaining({
					hudLayout: expect.objectContaining({
						inventory,
						journal: defaults.hudLayout.journal,
						partyHud: defaults.hudLayout.partyHud,
					}),
				}),
			}),
		}),
	);
	expect(bridge.resetUser).not.toHaveBeenCalled();
});
