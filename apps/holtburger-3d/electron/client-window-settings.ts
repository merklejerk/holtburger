import type { Rectangle } from "electron";

const MINIMUM_VISIBLE_WIDTH = 64;
const MINIMUM_VISIBLE_HEIGHT = 32;

/** Require a useful visible fragment, not a one-pixel intersection with a removed display. */
export function clientWindowBoundsReachable(
	bounds: Rectangle,
	workAreas: readonly Rectangle[],
): boolean {
	return workAreas.some((area) => {
		const width =
			Math.min(bounds.x + bounds.width, area.x + area.width) -
			Math.max(bounds.x, area.x);
		const height =
			Math.min(bounds.y + bounds.height, area.y + area.height) -
			Math.max(bounds.y, area.y);
		return width >= MINIMUM_VISIBLE_WIDTH && height >= MINIMUM_VISIBLE_HEIGHT;
	});
}
