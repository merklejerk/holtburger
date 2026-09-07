import type { Component } from "svelte";
import { mount } from "svelte";
import { createUiThemeLoader, defaultUiThemeUrl } from "./ui-theme";
import "./ui-base.css";

/** The application owns one document-wide theme selection. */
export const uiThemes = createUiThemeLoader(document);

export async function mountEntry(
	App: Component,
	themeUrl: string = defaultUiThemeUrl,
	overrideUrl: string | null = null,
): Promise<void> {
	const target = document.getElementById("app");

	if (target === null) {
		throw new Error("Missing #app mount target.");
	}

	// Publish appearance before any component mounts; this never owns runtime lifetime.
	await uiThemes.replace(themeUrl, overrideUrl);
	target.classList.add("ui-theme");
	mount(App, { target });
}
