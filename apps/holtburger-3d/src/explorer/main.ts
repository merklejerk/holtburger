import "../app/base.css";
import "./explorer.css";
import ContentStartup from "../app/ContentStartup.svelte";
import ExplorerApp from "./ExplorerApp.svelte";
import { mountEntryWithProps } from "../app/mount";
import { mount } from "svelte";

async function startGame(
	target: HTMLElement,
	isClosing: () => boolean,
	context: Map<unknown, unknown>,
): Promise<boolean> {
	if (isClosing()) return false;
	mount(ExplorerApp, { target, context });
	return true;
}

await mountEntryWithProps(ContentStartup, {
	mode: "explorer" as const,
	startGame,
});
