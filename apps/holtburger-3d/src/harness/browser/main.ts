import "../../app/base.css";
import "../../explorer/explorer.css";
import { mountEntry } from "../../app/mount";
import BrowserHarnessApp from "./BrowserHarnessApp.svelte";
import ClientHudHarness from "./ClientHudHarness.svelte";
import UiThemeHarness from "./UiThemeHarness.svelte";

mountEntry(
	new URLSearchParams(window.location.search).has("ui-theme")
		? UiThemeHarness
		: new URLSearchParams(window.location.search).has("client-hud")
			? ClientHudHarness
			: BrowserHarnessApp,
);
