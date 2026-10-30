import type { Action } from "svelte/action";
import type { InventoryEquipment } from "./client-inventory-equipment";

/** Mounted strip owners let drag transitions update layout before synchronous hit testing. */
const strips = new WeakMap<HTMLElement, EquipmentStripFilter>();

/** Collapses incompatible rows during dragging and restores the unfiltered scroll position. */
class EquipmentStripFilter {
	/** Null leaves all rows visible; a mask retains compatible drag destinations. */
	#drag: number | null = null;
	/** Unfiltered scroll position retained for the full equipment drag interval. */
	#savedScroll: number | null = null;
	/** Mounted scroll owner used for synchronous filtering and position restoration. */
	readonly #viewport: HTMLElement;

	constructor(private readonly node: HTMLElement) {
		const viewport = node.querySelector<HTMLElement>(
			".item-grid-strip-viewport",
		);
		if (viewport === null) throw new Error("Equipment strip viewport missing.");
		this.#viewport = viewport;
	}

	update(): void {
		this.#apply(false);
	}

	drag(locations: number | null): void {
		const changed = this.#drag !== locations;
		this.#drag = locations;
		this.#apply(changed);
	}

	#apply(resetScroll: boolean): void {
		const locations = this.#drag;
		const filtering = locations !== null && locations !== 0;
		if (filtering && this.#savedScroll === null)
			this.#savedScroll = this.#viewport.scrollTop;
		for (const row of this.node.querySelectorAll<HTMLElement>(
			"[data-equipment-slot]",
		)) {
			const mask = Number(row.dataset.equipmentSlot);
			row.hidden = filtering && (locations & mask) === 0;
		}
		// Preserve user scrolling when the same drag mask is refreshed.
		if (filtering && resetScroll) this.#viewport.scrollTop = 0;
		else if (!filtering && this.#savedScroll !== null) {
			this.#viewport.scrollTop = this.#savedScroll;
			this.#savedScroll = null;
		}
		// Scroll controls read layout after visibility and restoration agree.
		this.#viewport.dispatchEvent(new Event("scroll"));
	}
}

/** Row identity refreshes drag visibility after Svelte renders equipment changes. */
export const equipmentStripFilter: Action<
	HTMLElement,
	InventoryEquipment["rows"]
> = (node) => {
	const owner = new EquipmentStripFilter(node);
	strips.set(node, owner);
	owner.update();
	return {
		update: () => owner.update(),
		destroy: () => strips.delete(node),
	};
};

/** Null restores the complete strip when a drag ends or has no equipment destinations. */
export function filterDraggedEquipment(
	root: HTMLElement,
	locations: number | null,
): void {
	for (const node of root.querySelectorAll<HTMLElement>(".equipment-strip"))
		strips.get(node)?.drag(locations);
}
