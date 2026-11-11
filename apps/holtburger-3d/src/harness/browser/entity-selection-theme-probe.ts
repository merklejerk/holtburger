import { UI_THEME_CHANGED_EVENT } from "../../app/ui-theme";
import {
	readEntitySelectionColors,
	observeEntitySelectionColors,
} from "../../app/entity-selection-theme";
import type { EntitySelectionOutlineColors } from "../../lib/game/renderer/entity-selection-outline-policy";

/** Theme commits update renderer colors without a frame-rate CSS read or retained subscription. */
export function verifySelectionTheme(owner: Document): void {
	const scope = owner.createElement("div");
	owner.body.append(scope);
	const palettes: EntitySelectionOutlineColors[] = [];
	let observer: ReturnType<typeof observeEntitySelectionColors> | null = null;
	try {
		observer = observeEntitySelectionColors(scope, (colors) =>
			palettes.push(colors),
		);
		for (const field of ["color", "borderColor", "haloColor"] as const) {
			if (
				JSON.stringify(palettes[0][field]) !==
				JSON.stringify(readEntitySelectionColors(scope)[field])
			)
				throw new Error("Selection palette did not initialize from the theme.");
		}
		scope.style.setProperty("--ui-entity-selection-outline-color", "#123456");
		scope.style.setProperty("--ui-entity-selection-border-color", "#abcdef");
		scope.style.setProperty("--ui-entity-selection-halo-color", "#2468ac80");
		scope.ownerDocument.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
		const themed = readEntitySelectionColors(scope);
		if (
			palettes.length !== 2 ||
			JSON.stringify(palettes[1]) !== JSON.stringify(themed) ||
			JSON.stringify(palettes[0]) === JSON.stringify(themed)
		)
			throw new Error("Selection palette did not follow a theme commit.");
		observer.destroy();
		scope.ownerDocument.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
		if (palettes.length !== 2)
			throw new Error("Selection theme subscription survived teardown.");
		scope.style.setProperty(
			"--ui-entity-selection-halo-color",
			"invalid-color",
		);
		let rejected = false;
		try {
			readEntitySelectionColors(scope);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!error.message.includes("--ui-entity-selection-halo-color")
			)
				throw error;
			rejected = true;
		}
		if (!rejected)
			throw new Error("Invalid selection theme color was silently accepted.");
	} finally {
		observer?.destroy();
		scope.remove();
	}
}
