import { observeUiTheme } from "./ui-theme";
import { createUiThemeColorReader } from "./ui-theme-color";
import type { EntitySelectionOutlineColors } from "../lib/game/renderer/entity-selection-outline-policy";

/** Read the theme palette at the frontend boundary, never from renderer code. */
export function readEntitySelectionColors(
	element: HTMLElement,
): EntitySelectionOutlineColors {
	const read = createUiThemeColorReader(element);
	return {
		color: read("--ui-entity-selection-outline-color"),
		borderColor: read("--ui-entity-selection-border-color"),
		haloColor: read("--ui-entity-selection-halo-color"),
	};
}

/** Resolve the silhouette palette only on cold stylesheet/scope changes. */
export function observeEntitySelectionColors(
	element: HTMLElement,
	publish: (colors: EntitySelectionOutlineColors) => void,
) {
	return {
		destroy: observeUiTheme(element, () => {
			publish(readEntitySelectionColors(element));
		}),
	};
}
