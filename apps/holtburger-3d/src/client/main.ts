import "../app/base.css";
import ClientApp from "./ClientApp.svelte";
import { mountEntryWithProps } from "../app/mount";
import { clientDebugEnabled } from "./client-debug";
import { createClientShortcuts } from "./ClientShortcutDock.svelte";
import { createDefaultClientUserSettings } from "./client-settings-defaults";
import { createElectronClientSettingsTransport } from "./client-settings-transport";

const settingsTransport = createElectronClientSettingsTransport();
const loadedUserSettings = await settingsTransport.loadUser();
const initialUserSettings =
	loadedUserSettings.kind === "loaded"
		? loadedUserSettings.settings
		: createDefaultClientUserSettings(
				{ width: window.innerWidth, height: window.innerHeight },
				createClientShortcuts(clientDebugEnabled(window.location.search))
					.length,
			);
let initialSettingsSaveFailure: string | null = null;
if (loadedUserSettings.kind === "missing") {
	try {
		await settingsTransport.saveUser(initialUserSettings);
	} catch (error) {
		console.error("initial client settings save failed", error);
		initialSettingsSaveFailure =
			error instanceof Error ? error.message : String(error);
	}
}

await mountEntryWithProps(ClientApp, {
	initialUserSettings,
	initialSettingsSaveFailure,
	settingsTransport,
});
