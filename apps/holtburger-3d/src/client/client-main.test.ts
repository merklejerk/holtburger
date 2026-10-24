import { afterEach, expect, it, vi } from "vitest";
import { createDefaultClientUserSettings } from "./client-settings-defaults";

const { mount, bridge } = vi.hoisted(() => ({
	mount: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	bridge: { loadUser: vi.fn(), resetUser: vi.fn() },
}));
vi.mock("../app/mount", () => ({ mountEntryWithProps: mount }));
vi.mock("./ClientApp.svelte", () => ({ default: {} }));
vi.mock("./ClientShortcutDock.svelte", () => ({
	createClientShortcuts: () => [],
}));
vi.mock("./client-settings-transport", () => ({
	createElectronClientSettingsTransport: () => bridge,
}));
afterEach(() => vi.unstubAllGlobals());

it("composes new HUD defaults with older saved placements at the real entry point", async () => {
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
	});
	// Load the entry for its mounting side effect; Svelte-check owns its component export types.
	const entryModule = "./main";
	await import(entryModule);
	expect(mount).toHaveBeenCalledOnce();
	expect(mount.mock.calls[0]?.[1]).toMatchObject({
		initialUserSettings: {
			hudLayout: {
				inventory,
				journal: defaults.hudLayout.journal,
				partyHud: defaults.hudLayout.partyHud,
			},
		},
	});
	expect(bridge.resetUser).not.toHaveBeenCalled();
});
