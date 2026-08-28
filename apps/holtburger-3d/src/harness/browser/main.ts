import "../../app/theme.css";
import "../../app/ui.css";
import "../../explorer/explorer.css";
import { mountEntry } from "../../app/mount";
import BrowserHarnessApp from "./BrowserHarnessApp.svelte";
import ClientHudHarness from "./ClientHudHarness.svelte";

mountEntry(
	new URLSearchParams(window.location.search).has("client-hud")
		? ClientHudHarness
		: BrowserHarnessApp,
);
