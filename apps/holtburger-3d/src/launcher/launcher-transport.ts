import type { ServerDirectory } from "./server-directory-contract";
import {
	hardwareInfoRequestSchema,
	type HardwareInfoRequest,
} from "../app/hardware-info-contract";
import {
	appSettingsSchema,
	type AppSettings,
	type AppSettingsSnapshot,
} from "../app/app-settings-contract";
import type {
	LauncherSnapshot,
	LauncherPlay,
	ProfileSave,
	LauncherServer,
	LauncherCredentials,
	LauncherSelection,
} from "./launcher-contract";

/** Narrow launcher capabilities; encrypted envelopes stay native; credentials are loaded only by the admitted picker. */
interface LauncherBridge {
	/** Native application policy; unavailable launcher navigation must not be offered. */
	readonly enabled: boolean;
	snapshot(): Promise<LauncherSnapshot>;
	/** Process-wide preferences are available before any game connection or content setup. */
	appSettings(): Promise<AppSettingsSnapshot>;
	saveAppSettings(value: AppSettings): Promise<void>;
	/** Collect current host diagnostics and copy the report through the native clipboard. */
	copyHardwareInfo(value: HardwareInfoRequest): Promise<void>;
	/** Restart through the native application shutdown owner. */
	restart(): Promise<void>;
	/** Consume CLI content initialization once; later launcher documents load their profiles. */
	takeInitialContentPath(): Promise<string | null>;
	/** Browse without changing preferences or validating runtime content. */
	chooseContentPath(previous: string | null): Promise<string | null>;
	directory(refresh: boolean): Promise<ServerDirectory>;
	importServer(key: string): Promise<string | null>;
	saveServer(value: LauncherServer): Promise<void>;
	deleteServer(id: string): Promise<void>;
	saveProfile(value: ProfileSave): Promise<void>;
	deleteProfile(id: string): Promise<void>;
	credentials(
		selection: LauncherSelection,
	): Promise<LauncherCredentials | null>;
	recover(): Promise<void>;
	play(value: LauncherPlay): Promise<void>;
	/** Preserve the current page diagnostic when leaving a failed client attempt. */
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
		copyHardwareInfo: (value) =>
			bridge.copyHardwareInfo(hardwareInfoRequestSchema.parse(value)),
	};
}
