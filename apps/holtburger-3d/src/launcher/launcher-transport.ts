import type { ServerDirectory } from "./server-directory-contract";
import {
	hardwareInfoRequestSchema,
	type HardwareInfoRequest,
} from "../app/desktop/hardware-info-contract";
import {
	appSettingsSchema,
	defaultContentLocationSchema,
	type AppSettings,
	type AppSettingsSnapshot,
	type DefaultContentSnapshot,
} from "../app/desktop/app-settings-contract";
import {
	explorerLaunchRequestSchema,
	type ExplorerLaunchRequest,
	type LauncherSnapshot,
	type LauncherPlay,
	type ProfileSave,
	type LauncherServer,
	type LauncherCredentials,
	type LauncherSelection,
} from "./launcher-contract";

/** Narrow launcher capabilities; encrypted envelopes stay native; credentials are loaded only by the admitted picker. */
interface LauncherBridge {
	/** Native application policy; unavailable launcher navigation must not be offered. */
	readonly enabled: boolean;
	snapshot(): Promise<LauncherSnapshot>;
	/** Process-wide preferences are available before any game connection or content setup. */
	appSettings(): Promise<AppSettingsSnapshot>;
	saveAppSettings(value: AppSettings): Promise<void>;
	/** Load the saved default content directory preference. */
	defaultContent(): Promise<DefaultContentSnapshot>;
	/** Persist the default content directory, or null for automatic discovery. */
	saveDefaultContent(location: string | null): Promise<DefaultContentSnapshot>;
	/** Copy the saved application failure report, or return false if no report exists. */
	copyLastFailure(): Promise<boolean>;
	/** Collect current host diagnostics and copy the report through the native clipboard. */
	copyHardwareInfo(value: HardwareInfoRequest): Promise<void>;
	/** Restart through the native application shutdown owner. */
	restart(): Promise<void>;
	/** Browse without changing preferences or validating runtime content. */
	chooseContentPath(previous: string | null): Promise<string | null>;
	/** Browse for an explicit compiled `weenies.hwc` catalog file for Explorer mode. */
	chooseWeenieCatalog(previous: string | null): Promise<string | null>;
	/** Load persisted Explorer Launcher form preferences. */
	explorerSettings(): Promise<ExplorerLaunchRequest>;
	directory(refresh: boolean): Promise<ServerDirectory>;
	importServer(key: string): Promise<string | null>;
	saveServer(value: LauncherServer): Promise<void>;
	deleteServer(id: string): Promise<void>;
	saveProfile(value: ProfileSave): Promise<void>;
	deleteProfile(id: string): Promise<void>;
	credentials(
		selection: LauncherSelection,
	): Promise<LauncherCredentials | null>;
	play(value: LauncherPlay): Promise<void>;
	launchExplorer(value: ExplorerLaunchRequest): Promise<void>;
	/** Preserve the current page diagnostic when leaving a failed game attempt. */
	back(diagnostic: string | null): Promise<void>;
}
declare global {
	interface Window {
		holtburgerLauncher?: LauncherBridge;
	}
}
/** Main validates every mutation and gates saved credential access to the current picker. */
export function launcherTransport(): LauncherBridge {
	const bridge = window.holtburgerLauncher;
	if (!bridge) throw new Error("Launcher bridge is unavailable");
	return {
		...bridge,
		// Schema parsing produces plain values for Electron IPC; Svelte draft proxies cannot be cloned.
		saveAppSettings: (value) =>
			bridge.saveAppSettings(appSettingsSchema.parse(value)),
		saveDefaultContent: (location) =>
			bridge.saveDefaultContent(defaultContentLocationSchema.parse(location)),
		copyHardwareInfo: (value) =>
			bridge.copyHardwareInfo(hardwareInfoRequestSchema.parse(value)),
		launchExplorer: (value) =>
			bridge.launchExplorer(explorerLaunchRequestSchema.parse(value)),
	};
}
