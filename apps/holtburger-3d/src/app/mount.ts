import type { Component } from "svelte";
import { mount } from "svelte";
import { applyUiTheme } from "./ui-theme";
import { ESPRESSO_AERO } from "./themes/espresso-aero";
import "./ui-theme-recipes.css";

export function mountEntry(App: Component): void {
	const target = document.getElementById("app");

	if (target === null) {
		throw new Error("Missing #app mount target.");
	}

	// Publish appearance before any component mounts; this never owns runtime lifetime.
	applyUiTheme(document.documentElement, ESPRESSO_AERO, {
		reducedTransparency: false,
	});
	target.classList.add("ui-theme");
	mount(App, { target });
}
