import "../../app/base.css";
import "../../explorer/explorer.css";
import { mountEntry } from "../../app/mount";

/** Load only the selected browser composition. */
async function start(): Promise<void> {
	const query = new URLSearchParams(window.location.search);
	const { default: App } = query.has("item-cooldowns")
		? await import("./ItemCooldownHarness.svelte")
		: query.has("client-presentation")
			? await import("./ClientPresentationHarness.svelte")
			: query.has("pregame-preview")
				? await import("./PregamePreviewHarness.svelte")
				: query.has("world-map")
					? await import("./WorldMapHarness.svelte")
					: query.has("ui-showcase")
						? await import("./UiShowcase.svelte")
						: query.has("ui-theme")
							? await import("./UiThemeHarness.svelte")
							: query.has("client-hud")
								? await import("./ClientHudHarness.svelte")
								: await import("./BrowserHarnessApp.svelte");
	await mountEntry(App);
}
void start();
