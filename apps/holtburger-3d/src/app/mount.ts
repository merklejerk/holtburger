import type { Component } from "svelte";
import { mount } from "svelte";

export function mountEntry(App: Component): void {
	const target = document.getElementById("app");

	if (target === null) {
		throw new Error("Missing #app mount target.");
	}

	mount(App, { target });
}
