import "../../app/base.css";
import "../../explorer/explorer.css";
import { mountEntry } from "../../app/mount";

/** Load only the selected browser composition. */
async function start(): Promise<void> {
	const query = new URLSearchParams(window.location.search);
	const { default: App } = query.has("performance-surfaces")
		? await import("./PerformanceSurfaceHarness.svelte")
		: query.has("ui-showcase")
			? await import("./UiShowcase.svelte")
			: query.has("ui-theme")
				? await import("./UiThemeHarness.svelte")
				: await import("./BrowserHarnessApp.svelte");
	await mountEntry(App);
}
void start();
