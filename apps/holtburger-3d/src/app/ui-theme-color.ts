import type { NormalizedRgbaColor } from "../lib/frontend-color";

/** Resolve CSS color tokens at one cold appearance boundary, including inherited/current colors. */
export function createUiThemeColorReader(element: HTMLElement) {
	const style = getComputedStyle(element);
	const canvas = element.ownerDocument.createElement("canvas");
	canvas.width = canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (context === null)
		throw new Error("Canvas2D unavailable for theme colors.");
	return (property: string): NormalizedRgbaColor => {
		const value = style.getPropertyValue(property).trim();
		if (!CSS.supports("color", value))
			throw new Error(`Invalid theme color ${property}: ${value}`);
		const swatch = element.ownerDocument.createElement("span");
		swatch.style.display = "none";
		swatch.style.color = value;
		element.append(swatch);
		try {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = getComputedStyle(swatch).color;
			context.fillRect(0, 0, 1, 1);
			const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
			return {
				red: red / 255,
				green: green / 255,
				blue: blue / 255,
				alpha: alpha / 255,
			};
		} finally {
			swatch.remove();
		}
	};
}
