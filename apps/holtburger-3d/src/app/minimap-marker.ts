import alertSvg from "../assets/icons/minimap-alert.svg?raw";
import useableSvg from "../assets/icons/minimap-useable.svg?raw";
import corpseSvg from "../assets/icons/minimap-own-corpse.svg?raw";
import { MAP_BLIP_FILL_COLORS } from "../lib/game/map/map-appearance";
import type { MapLandmarkCategory } from "../lib/game/map/map-blip-category";

/** Canvas size of SVG marker glyphs; also bounds selection feedback. */
export const MINIMAP_ICON_SIZE = 14;

/** Icon categories share placement, hit testing, and selection feedback. */
export type MinimapIconCategory = "alert" | MapLandmarkCategory;

/** One authored fill layer, compiled outside the draw loop. */
interface MinimapMarkerLayer {
	/** Resolved paint for the icon's solid fill. */
	readonly color: string;
	/** Authored icon geometry in its SVG viewBox coordinates. */
	readonly path: Path2D;
}

/** The first layer supplies the silhouette halo; later layers add authored details. */
export type MinimapMarker = readonly [
	MinimapMarkerLayer,
	...MinimapMarkerLayer[],
];

/** Read the local palette and compile the authored SVG path on mount/theme changes. */
export function readMinimapMarkers(
	element: HTMLElement,
): Readonly<Record<MinimapIconCategory, MinimapMarker>> {
	const property = "--ui-minimap-alert-color";
	const color = getComputedStyle(element).getPropertyValue(property).trim();
	if (!CSS.supports("color", color))
		throw new Error(`Invalid minimap theme color ${property}: ${color}`);
	const probe = element.ownerDocument.createElement("span");
	probe.style.color = color;
	probe.style.display = "none";
	element.append(probe);
	try {
		return {
			alert: markerLayers(alertSvg, getComputedStyle(probe).color),
			useable: markerLayers(useableSvg, MAP_BLIP_FILL_COLORS.useable),
			"own-corpse": markerLayers(corpseSvg, MAP_BLIP_FILL_COLORS["own-corpse"]),
		};
	} finally {
		probe.remove();
	}
}

/** Resolve inherited palette paint while preserving explicit SVG detail colors. */
function markerLayers(svg: string, color: string): MinimapMarker {
	const asset = new DOMParser().parseFromString(svg, "image/svg+xml");
	const layers = [...asset.querySelectorAll("path")].map((element) => {
		const path = element.getAttribute("d");
		if (!path) throw new Error("Minimap marker path requires geometry.");
		const fill = element.getAttribute("fill");
		const paint = fill === null || fill === "currentColor" ? color : fill;
		if (!CSS.supports("color", paint))
			throw new Error(`Invalid minimap marker fill: ${paint}`);
		return { color: paint, path: new Path2D(path) };
	});
	const [silhouette, ...details] = layers;
	if (silhouette === undefined)
		throw new Error("Minimap marker SVG requires a silhouette path.");
	return [silhouette, ...details];
}

/** Draw an authored icon with a dark halo above the map geometry. */
export function drawMinimapMarker(
	context: CanvasRenderingContext2D,
	marker: MinimapMarker,
	x: number,
	y: number,
): void {
	context.save();
	context.translate(x - MINIMAP_ICON_SIZE / 2, y - MINIMAP_ICON_SIZE / 2);
	// The authored icon uses a 24-unit viewBox.
	context.scale(MINIMAP_ICON_SIZE / 24, MINIMAP_ICON_SIZE / 24);
	context.lineJoin = "round";
	context.lineCap = "round";
	context.lineWidth = 2;
	context.strokeStyle = "rgba(0, 0, 0, 0.85)";
	context.stroke(marker[0].path);
	for (const layer of marker) {
		context.fillStyle = layer.color;
		context.fill(layer.path);
	}
	context.restore();
}
