import alertSvg from "../assets/icons/minimap-alert.svg?raw";

/** Canvas size of the shared alert glyph; also bounds selection feedback. */
export const MINIMAP_ALERT_ICON_SIZE = 14;

/** Theme-resolved paint and asset-authored geometry, cached outside the draw loop. */
export interface MinimapAlertMarker {
	/** Resolved local theme color for the icon fill. */
	readonly color: string;
	/** Authored star silhouette in its SVG viewBox coordinates. */
	readonly path: Path2D;
}

/** Read the local palette and compile the authored SVG path on mount/theme changes. */
export function readMinimapAlertMarker(
	element: HTMLElement,
): MinimapAlertMarker {
	const property = "--ui-minimap-alert-color";
	const color = getComputedStyle(element).getPropertyValue(property).trim();
	if (!CSS.supports("color", color))
		throw new Error(`Invalid minimap theme color ${property}: ${color}`);
	const probe = element.ownerDocument.createElement("span");
	probe.style.color = color;
	probe.style.display = "none";
	element.append(probe);
	try {
		const asset = new DOMParser().parseFromString(alertSvg, "image/svg+xml");
		const path = asset.querySelector("path")?.getAttribute("d");
		if (!path) throw new Error("Minimap alert SVG requires a path.");
		return { color: getComputedStyle(probe).color, path: new Path2D(path) };
	} finally {
		probe.remove();
	}
}

/** Replace an entity's ordinary marker with the same star for every alert match. */
export function drawMinimapAlertMarker(
	context: CanvasRenderingContext2D,
	marker: MinimapAlertMarker,
	x: number,
	y: number,
): void {
	context.save();
	context.translate(
		x - MINIMAP_ALERT_ICON_SIZE / 2,
		y - MINIMAP_ALERT_ICON_SIZE / 2,
	);
	// The authored icon uses a 24-unit viewBox.
	context.scale(MINIMAP_ALERT_ICON_SIZE / 24, MINIMAP_ALERT_ICON_SIZE / 24);
	context.lineWidth = 2;
	context.strokeStyle = "rgba(0, 0, 0, 0.85)";
	context.stroke(marker.path);
	context.fillStyle = marker.color;
	context.fill(marker.path);
	context.restore();
}
