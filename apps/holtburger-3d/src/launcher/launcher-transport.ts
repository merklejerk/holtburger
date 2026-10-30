import type { ServerDirectory } from "./server-directory-contract";
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
	return bridge;
}
