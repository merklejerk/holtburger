import "../app/base.css";
import "./explorer.css";
import { mount } from "svelte";
import ContentStartup from "../app/desktop/ContentStartup.svelte";
import { mountEntryWithProps, uiThemes } from "../app/mount";
import { withBundledUiThemes } from "../app/theme/ui-bundled-themes";
import { UiThemeSelection } from "../app/theme/ui-theme-selection";
import { createElectronUiThemeTransport } from "../app/theme/ui-theme-transport";
import type { ExplorerLaunchConfig } from "../launcher/launcher-contract";
import { detectInputPlatform } from "../lib/input/input-platform";
import ExplorerApp from "./ExplorerApp.svelte";
import { createElectronExplorerSettingsTransport } from "./settings/explorer-settings-transport";

declare global {
	interface Window {
		/** Explorer-only launch bootstrap configuration read on mount. */
		holtburgerExplorer?: {
			launchConfig(): Promise<ExplorerLaunchConfig>;
		};
	}
}

async function readExplorerLaunchConfig(): Promise<ExplorerLaunchConfig> {
	const bridge = globalThis.window?.holtburgerExplorer;
	if (bridge === undefined) return { initialLocation: null };
	return bridge.launchConfig();
}

async function startGame(
	target: HTMLElement,
	signal: AbortSignal,
	context: Map<unknown, unknown>,
	contentLocation: string,
): Promise<boolean> {
	const platform = detectInputPlatform(navigator.userAgent);
	const settingsTransport = createElectronExplorerSettingsTransport();
	const [loadedUserSettings, launchConfig] = await Promise.all([
		settingsTransport.loadUser({ platform }),
		readExplorerLaunchConfig(),
	]);
	if (signal.aborted) return false;
	const initialUserSettings = loadedUserSettings.settings;
	let initialSettingsIssue =
		loadedUserSettings.repaired.length > 0
			? loadedUserSettings.repaired.join("; ")
			: null;

	const themeSelection = new UiThemeSelection(
		withBundledUiThemes(createElectronUiThemeTransport()),
		uiThemes,
		signal,
	);
	try {
		await themeSelection.refresh();
		if (signal.aborted) {
			await themeSelection.retire();
			return false;
		}
		await themeSelection.select(initialUserSettings.ui.themeId);
		if (signal.aborted) {
			await themeSelection.retire();
			return false;
		}
		const themeState = themeSelection.read();
		const themeIssues = [
			themeState.catalog.kind === "failed" ? themeState.catalog.message : null,
			themeState.selection.kind === "failed"
				? themeState.selection.message
				: null,
		].filter((issue) => issue !== null);
		if (themeIssues.length)
			initialSettingsIssue = [initialSettingsIssue, ...themeIssues]
				.filter((issue) => issue !== null)
				.join("; ");
		mount(ExplorerApp, {
			target,
			context,
			props: {
				platform,
				contentLocation,
				themeSelection,
				initialUserSettings,
				initialSettingsIssue,
				settingsTransport,
				launchConfig,
			},
		});
		return true;
	} catch (error) {
		await themeSelection.retire();
		throw error;
	}
}

await mountEntryWithProps(ContentStartup, {
	mode: "explorer" as const,
	startGame,
});
