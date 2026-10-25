import { createElectronVisualCacheTransport } from "./client-visual-cache-transport";
import "../app/base.css";
import ContentStartup from "../app/ContentStartup.svelte";
import ClientApp from "./ClientApp.svelte";
import { mount } from "svelte";
import { mountEntryWithProps } from "../app/mount";
import { clientDebugEnabled } from "./client-debug";
import { createClientShortcuts } from "./ClientShortcutDock.svelte";
import { createDefaultClientUserSettings } from "./client-settings-defaults";
import { createElectronClientSettingsTransport } from "./client-settings-transport";

async function startGame(
	target: HTMLElement,
	isClosing: () => boolean,
	context: Map<unknown, unknown>,
	contentLocation: string,
): Promise<boolean> {
	const settingsTransport = createElectronClientSettingsTransport();
	const defaults = createDefaultClientUserSettings(
		{ width: window.innerWidth, height: window.innerHeight },
		createClientShortcuts(clientDebugEnabled(window.location.search)).length,
	);
	const loadedUserSettings = await settingsTransport.loadUser(defaults);
	if (isClosing()) return false;
	const initialUserSettings = {
		...defaults,
		...loadedUserSettings.sections,
		hudLayout: { ...defaults.hudLayout, ...loadedUserSettings.hudPlacements },
	};
	let initialSettingsIssue: string | null =
		loadedUserSettings.unavailable.length > 0 ||
		loadedUserSettings.repaired.length > 0
			? [
					...loadedUserSettings.repaired,
					...loadedUserSettings.unavailable,
				].join("; ")
			: null;
	if (
		Object.keys(loadedUserSettings.sections).length === 0 &&
		Object.keys(loadedUserSettings.hudPlacements).length === 0
	) {
		try {
			const blocked = await settingsTransport.resetUser(initialUserSettings);
			if (blocked.length > 0) initialSettingsIssue = blocked.join("; ");
		} catch (error) {
			console.error("initial client settings save failed", error);
			initialSettingsIssue =
				error instanceof Error ? error.message : String(error);
		}
	}

	if (isClosing()) return false;
	mount(ClientApp, {
		target,
		context,
		props: {
			contentLocation,
			initialUserSettings,
			initialSettingsIssue,
			settingsTransport,
			visualCacheTransport: createElectronVisualCacheTransport(),
		},
	});
	return true;
}

await mountEntryWithProps(ContentStartup, {
	mode: "client" as const,
	startGame,
});
