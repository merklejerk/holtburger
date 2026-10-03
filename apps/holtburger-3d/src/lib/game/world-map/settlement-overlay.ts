import settlementSvg from "../../../assets/icons/world-map-settlement.svg?raw";
import type { WorldMapView } from "./types";
import {
	projectWorldMapSettlements,
	hitWorldMapSettlement,
	type WorldMapSettlement,
	type WorldMapSettlementPlacement,
} from "./settlements";

/** Retained theme-styled SVG anchors; no input-rate reactive state or text measurement. */
export class WorldMapSettlementOverlay {
	readonly #root: SVGGElement;
	readonly #nodes: ReadonlyMap<string, SVGGElement>;
	readonly #settlements: readonly WorldMapSettlement[];
	#placements: readonly WorldMapSettlementPlacement[] = [];

	constructor(root: SVGGElement, settlements: readonly WorldMapSettlement[]) {
		this.#root = root;
		this.#settlements = settlements;
		// Parse the authored asset once; each retained anchor owns an independent clone.
		const dotTemplate = new DOMParser().parseFromString(
			settlementSvg,
			"image/svg+xml",
		).documentElement;
		if (!(dotTemplate instanceof SVGSVGElement))
			throw new Error("World map settlement asset must be a valid SVG.");
		const nodes = new Map<string, SVGGElement>();
		for (const settlement of settlements) {
			const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
			group.dataset.settlement = settlement.name;
			const dot = document.importNode(dotTemplate, true);
			const text = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"text",
			);
			text.textContent = settlement.name;
			text.classList.add("ui-world-map-label");
			group.append(dot, text);
			root.append(group);
			nodes.set(settlement.name, group);
		}
		this.#nodes = nodes;
		this.clear();
	}

	draw(view: WorldMapView, width: number, height: number): void {
		this.#root.style.display = "";
		this.#placements = projectWorldMapSettlements(
			this.#settlements,
			view,
			width,
			height,
		);
		for (const group of this.#nodes.values()) group.style.display = "none";
		for (const placement of this.#placements) {
			const group = this.#node(placement.settlement.name);
			group.style.display = "";
			group.setAttribute(
				"transform",
				`translate(${placement.x} ${placement.y})`,
			);
		}
	}
	hit(x: number, y: number): WorldMapSettlement | null {
		return hitWorldMapSettlement(this.#placements, x, y);
	}
	/** Cold user choice changes CSS visibility without rebuilding or reprojecting anchors. */
	showLabels(showAll: boolean): void {
		this.#root.classList.toggle("ui-world-map-labels-visible", showAll);
	}
	clear(): void {
		this.#root.style.display = "none";
		this.#placements = [];
	}
	destroy(): void {
		this.#root.replaceChildren();
		this.#placements = [];
	}
	#node(name: string) {
		const node = this.#nodes.get(name);
		if (!node) throw new Error(`Missing settlement overlay node: ${name}.`);
		return node;
	}
}
