import "../app/base.css";
import ClientApp from "./ClientApp.svelte";
import { mountEntryWithProps } from "../app/mount";
import { clientDebugEnabled } from "./client-debug";
import { createClientShortcuts } from "./ClientShortcutDock.svelte";
import { createDefaultClientUserSettings } from "./client-settings-defaults";
import { createElectronClientSettingsTransport } from "./client-settings-transport";

const settingsTransport = createElectronClientSettingsTransport();
const loadedUserSettings = await settingsTransport.loadUser();
const defaults = createDefaultClientUserSettings(
	{ width: window.innerWidth, height: window.innerHeight },
	createClientShortcuts(clientDebugEnabled(window.location.search)).length,
);
const initialUserSettings = {
	...defaults,
	...loadedUserSettings.sections,
	hudLayout: { ...defaults.hudLayout, ...loadedUserSettings.hudPlacements },
};
let initialSettingsIssue: string | null =
	loadedUserSettings.unavailable.length > 0
		? loadedUserSettings.unavailable.join("; ")
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

await mountEntryWithProps(ClientApp, {
	initialUserSettings,
	initialSettingsIssue,
	settingsTransport,
});
