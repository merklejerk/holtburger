/** Narrow return-to-launcher slice of the Electron launcher preload bridge. */
interface LauncherNavigationBridge {
	readonly enabled: boolean;
	back(diagnostic: string | null): Promise<void>;
}

function readNavigationBridge(): LauncherNavigationBridge | undefined {
	return (
		window as Window & {
			readonly holtburgerLauncher?: LauncherNavigationBridge;
		}
	).holtburgerLauncher;
}

/** Whether Electron exposes a launcher window this mode can return to. */
export function isLauncherReturnAvailable(): boolean {
	return readNavigationBridge()?.enabled === true;
}

/** Return from an active mode or startup failure to the native launcher window. */
export async function returnToLauncher(
	diagnostic: string | null,
): Promise<void> {
	const bridge = readNavigationBridge();
	if (!bridge) throw new Error("Launcher bridge is unavailable");
	await bridge.back(diagnostic);
}
