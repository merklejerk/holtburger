import "../../app/base.css";
import "../../explorer/explorer.css";
import { mountEntry } from "../../app/mount";

/** Load only the selected composition; the UI showcase never imports the world runtime. */
async function start(): Promise<void> {
	const query = new URLSearchParams(window.location.search);
	const { default: App } = query.has("ui-showcase")
		? await import("./UiShowcase.svelte")
		: query.has("ui-theme")
			? await import("./UiThemeHarness.svelte")
			: query.has("client-hud")
				? await import("./ClientHudHarness.svelte")
				: await import("./BrowserHarnessApp.svelte");
	await mountEntry(App);
}
void start();
