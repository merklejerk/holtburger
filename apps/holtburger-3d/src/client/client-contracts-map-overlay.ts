import equal from "fast-deep-equal";
import contactIcon from "../assets/icons/world-map-contract-contact.svg?raw";
import questIcon from "../assets/icons/world-map-contract-area.svg?raw";
import { projectWorldMapPoint } from "../lib/game/world-map/view";
import type { WorldMapView } from "../lib/game/world-map/types";
import type { ContractsSnapshot } from "./client-contracts-contract";
import {
	contractMapMarkers,
	contractMapTooltips,
	type ContractMapMarker,
} from "./client-contracts-map";
import { CLIENT_TUNING } from "./client-tuning";

/** Retained role icons and cold tooltip text; gestures only reproject prepared points. */
export class ContractMapOverlay {
	readonly #root: SVGGElement;
	readonly #contact: SVGSVGElement;
	readonly #quest: SVGSVGElement;
	#markers: readonly ContractMapMarker[] = [];
	#nodes = new Map<string, SVGGElement>();
	#tooltips: ReadonlyMap<string, string> = new Map();
	#placements: {
		readonly key: string;
		readonly x: number;
		readonly y: number;
	}[] = [];

	constructor(root: SVGGElement) {
		this.#root = root;
		const template = (source: string): SVGSVGElement => {
			const svg = new DOMParser().parseFromString(
				source,
				"image/svg+xml",
			).documentElement;
			if (!(svg instanceof SVGSVGElement))
				throw new Error("Contract map icon must be SVG.");
			const size = CLIENT_TUNING.journal.mapMarkerSizeCssPixels;
			svg.setAttribute("width", String(size));
			svg.setAttribute("height", String(size));
			svg.setAttribute("x", String(-size / 2));
			svg.setAttribute("y", String(-size / 2));
			// HUD icons fill their container; map anchors instead have a fixed pixel footprint.
			svg.style.width = `${size}px`;
			svg.style.height = `${size}px`;
			return svg;
		};
		this.#contact = template(contactIcon);
		this.#quest = template(questIcon);
	}
	/** Cold snapshot/aging refresh; retain nodes unless projected destinations change. */
	setFacts(facts: ContractsSnapshot | null): void {
		const markers = contractMapMarkers(facts);
		if (equal(markers, this.#markers)) {
			this.#tooltips = contractMapTooltips(this.#markers, facts);
			return;
		}
		this.clear();
		this.#markers = markers;
		for (const marker of this.#markers) {
			const contact =
				marker.entries.length === 1 && marker.entries[0]?.role !== "area";
			const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
			group.dataset.contractMarker = marker.key;
			group.dataset.contractRole = contact ? "contact" : "quest";
			group.append(
				document.importNode(contact ? this.#contact : this.#quest, true),
			);
			this.#root.append(group);
			this.#nodes.set(marker.key, group);
		}
		this.#tooltips = contractMapTooltips(this.#markers, facts);
	}
	draw(view: WorldMapView, width: number, height: number): void {
		this.#placements = [];
		for (const marker of this.#markers) {
			const [x, y] = projectWorldMapPoint(
				{ x: marker.position[0], z: marker.position[2] },
				view,
				width,
				height,
			);
			const node = this.#nodes.get(marker.key);
			if (node === undefined)
				throw new Error(`Missing contract map node: ${marker.key}`);
			const visible = x >= 0 && y >= 0 && x <= width && y <= height;
			node.style.display = visible ? "" : "none";
			if (!visible) continue;
			node.setAttribute("transform", `translate(${x} ${y})`);
			this.#placements.push({ key: marker.key, x, y });
		}
	}
	/** Every overlapping icon remains discoverable; exact coincident entries already share a node. */
	hit(x: number, y: number): string {
		const radius = CLIENT_TUNING.journal.mapMarkerSizeCssPixels / 2;
		return this.#placements
			.filter(
				(point) =>
					Math.abs(point.x - x) <= radius && Math.abs(point.y - y) <= radius,
			)
			.map((point) => {
				const text = this.#tooltips.get(point.key);
				if (text === undefined)
					throw new Error(`Missing contract map tooltip: ${point.key}`);
				return text;
			})
			.filter((text) => text !== "")
			.join("\n\n");
	}
	clear(): void {
		this.#root.replaceChildren();
		this.#nodes.clear();
		this.#markers = [];
		this.#placements = [];
		this.#tooltips = new Map();
	}
	/** No image/view yet: keep prepared facts so progressive loading can reveal them. */
	hide(): void {
		for (const node of this.#nodes.values()) node.style.display = "none";
		this.#placements = [];
	}
}
