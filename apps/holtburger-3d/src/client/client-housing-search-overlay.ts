import icon from "../assets/icons/world-map-housing-search.svg?raw";
import type { WorldMapView } from "../lib/game/world-map/types";
import {
	prepareHousingSearchAreas,
	projectHousingSearchAreas,
	type HousingSearchArea,
} from "./client-housing-search-map";
import { CLIENT_TUNING } from "./client-tuning";

/** Search-only retained SVG layer; map gestures never publish arrays through Svelte. */
export class HousingSearchOverlay {
	readonly #root: SVGGElement;
	readonly #template: SVGSVGElement;
	readonly #nodes = new Map<string, SVGGElement>();
	#areas: readonly HousingSearchArea[] = [];
	#cells: readonly number[] | null = null;
	constructor(root: SVGGElement) {
		this.#root = root;
		const template = new DOMParser().parseFromString(
			icon,
			"image/svg+xml",
		).documentElement;
		if (!(template instanceof SVGSVGElement))
			throw new Error("Housing search icon must be SVG.");
		this.#template = template;
	}
	/** Accepted dataset identity controls preparation, not player motion or map draw frequency. */
	setAreas(cells: readonly number[] | null): void {
		if (cells === this.#cells) return;
		this.#cells = cells;
		this.#areas = cells === null ? [] : prepareHousingSearchAreas(cells);
		if (cells === null) this.clear();
	}
	draw(view: WorldMapView, width: number, height: number): void {
		const placements = projectHousingSearchAreas(
			this.#areas,
			view,
			width,
			height,
			CLIENT_TUNING.housingSearch.clusterSpacingCssPixels,
		);
		const retained = new Set<string>();
		for (const placement of placements) {
			const key = placement.areas.join(",");
			retained.add(key);
			let node = this.#nodes.get(key);
			if (!node) {
				node = document.createElementNS("http://www.w3.org/2000/svg", "g");
				node.dataset.housingSearchAreas = key;
				node.append(document.importNode(this.#template, true));
				this.#root.append(node);
				this.#nodes.set(key, node);
			}
			node.setAttribute(
				"transform",
				`translate(${placement.x} ${placement.y})`,
			);
		}
		for (const [key, node] of this.#nodes)
			if (!retained.has(key)) {
				node.remove();
				this.#nodes.delete(key);
			}
	}
	clear(): void {
		this.#root.replaceChildren();
		this.#nodes.clear();
	}
	destroy(): void {
		this.clear();
		this.#areas = [];
		this.#cells = null;
	}
}
