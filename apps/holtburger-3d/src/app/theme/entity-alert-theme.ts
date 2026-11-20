import { observeUiTheme } from "./ui-theme";
import { createUiThemeColorReader } from "./ui-theme-color";
import type { NormalizedRgbaColor } from "../../lib/frontend-color";

/** Theme-owned colors for in-world alert indicators, resolved outside the render loop. */
interface EntityAlertThemeColors {
	/** Nameplate top star crest fill color. */
	readonly crestColor: NormalizedRgbaColor;
	/** In-scene 3D hollow cylinder and base ring color. */
	readonly beaconColor: NormalizedRgbaColor;
	/** Rising sparkle motes on the 3D cylinder wall; transparent disables sparkles. */
	readonly sparkleColor: NormalizedRgbaColor;
}

/** Read alert indicator colors at the frontend boundary, never from renderer code. */
function readEntityAlertColors(element: HTMLElement): EntityAlertThemeColors {
	const read = createUiThemeColorReader(element);
	return {
		crestColor: read("--ui-entity-alert-crest-color"),
		beaconColor: read("--ui-entity-alert-beacon-color"),
		sparkleColor: read("--ui-entity-alert-beacon-sparkle-color"),
	};
}

/** Resolve alert indicator colors only on cold stylesheet/scope changes. */
export function observeEntityAlertColors(
	element: HTMLElement,
	publish: (colors: EntityAlertThemeColors) => void,
) {
	return {
		destroy: observeUiTheme(element, () => {
			publish(readEntityAlertColors(element));
		}),
	};
}
