import { createElectronVisualCacheTransport } from "./client-visual-cache-transport";
import "../app/base.css";
import ContentStartup from "../app/ContentStartup.svelte";
import ClientApp from "./ClientApp.svelte";
import { mount } from "svelte";
import { UiThemeSelection } from "../app/ui-theme-selection";
import { createElectronUiThemeTransport } from "../app/ui-theme-transport";
import { withBundledUiThemes } from "../app/ui-bundled-themes";
import { uiThemes, mountEntryWithProps } from "../app/mount";
import { clientDebugEnabled } from "./client-debug";
import { createClientShortcuts } from "./ClientShortcutDock.svelte";
import { createElectronClientSettingsTransport } from "./client-settings-transport";

async function startGame(
	target: HTMLElement,
	signal: AbortSignal,
	context: Map<unknown, unknown>,
	contentLocation: string,
): Promise<boolean> {
	const settingsTransport = createElectronClientSettingsTransport();
	const loadedUserSettings = await settingsTransport.loadUser({
		viewport: { width: window.innerWidth, height: window.innerHeight },
		shortcutCount: createClientShortcuts(
			clientDebugEnabled(window.location.search),
		).length,
	});
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
		mount(ClientApp, {
			target,
			context,
			props: {
				contentLocation,
				themeSelection,
				initialUserSettings,
				initialSettingsIssue,
				settingsTransport,
				visualCacheTransport: createElectronVisualCacheTransport(),
			},
		});
		return true;
	} catch (error) {
		await themeSelection.retire();
		throw error;
	}
}

await mountEntryWithProps(ContentStartup, {
	mode: "client" as const,
	startGame,
});
