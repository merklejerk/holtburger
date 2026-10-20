/** Resolved canvas appearance; CSS is read only when the theme or local scope changes. */
export interface MinimapTrackingAppearance {
	/** CSS color resolved in the minimap's inherited palette. */
	readonly color: string;
	/** Positive stroke width in canvas pixels. */
	readonly width: number;
	/** Nonnegative spacing outside the ordinary marker radius. */
	readonly gap: number;
	/** Canvas dash/gap pair; zero values permit a solid ring. */
	readonly dash: number[];
}

/** Let CSS resolve palette references and length units before passing values to Canvas2D. */
export function readMinimapTrackingAppearance(
	element: HTMLElement,
): MinimapTrackingAppearance {
	const theme = getComputedStyle(element);
	const probe = element.ownerDocument.createElement("span");
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.pointerEvents = "none";
	probe.style.boxSizing = "content-box";
	const colorProperty = "--ui-minimap-tracked-color";
	const color = theme.getPropertyValue(colorProperty).trim();
	if (!CSS.supports("color", color))
		throw new Error(`Invalid minimap theme color ${colorProperty}: ${color}`);
	probe.style.color = color;
	element.append(probe);
	try {
		const pixels = (property: string, positive: boolean) => {
			const value = theme.getPropertyValue(property).trim();
			// Padding's grammar admits nonnegative lengths/percentages, but excludes
			// width keywords such as auto that do not specify a ring dimension.
			if (!CSS.supports("padding-left", value))
				throw new Error(`Invalid minimap theme length ${property}: ${value}`);
			probe.style.width = value;
			// Used width resolves percentages as well as rem and calc() to pixels.
			const number = probe.getBoundingClientRect().width;
			if (positive && number === 0)
				throw new Error(`Minimap theme length ${property} must be positive.`);
			return number;
		};
		return {
			color: getComputedStyle(probe).color,
			width: pixels("--ui-minimap-tracked-width", true),
			gap: pixels("--ui-minimap-tracked-gap", false),
			dash: [
				pixels("--ui-minimap-tracked-dash-length", false),
				pixels("--ui-minimap-tracked-dash-gap", false),
			],
		};
	} finally {
		probe.remove();
	}
}
