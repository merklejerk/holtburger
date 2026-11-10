import { observeUiTheme } from "../app/ui-theme";
import { createUiThemeColorReader } from "../app/ui-theme-color";
import type { SummonLeashColor } from "../lib/game/runtime/summon-presentation";

/** Theme-owned local/remote ownership palette; game and renderer layers do not classify it. */
export type ClientSummonLeashColors = Readonly<
	Record<"own" | "other", SummonLeashColor>
>;

/** CSS owns leash RGB and opacity, including inheritance and user stylesheet overrides. */
export function readSummonLeashColors(
	element: HTMLElement,
): ClientSummonLeashColors {
	const read = createUiThemeColorReader(element);
	const color = (property: string): SummonLeashColor => {
		const { red, green, blue, alpha } = read(property);
		return [red, green, blue, alpha];
	};
	return {
		own: color("--ui-summon-leash-own-color"),
		other: color("--ui-summon-leash-other-color"),
	};
}

/** Publish only on cold scope/stylesheet changes; CSS never enters the render loop. */
export function observeSummonLeashColors(
	element: HTMLElement,
	publish: (colors: ClientSummonLeashColors) => void,
) {
	return {
		destroy: observeUiTheme(element, () =>
			publish(readSummonLeashColors(element)),
		),
	};
}
