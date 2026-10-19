import type { InventoryEquipment } from "./client-inventory-equipment";

/** Mounted strip owners let drag transitions update layout before synchronous hit testing. */
const strips = new WeakMap<HTMLElement, EquipmentStripFilter>();

/** Cold hover inputs; row identity refreshes dimming and drag visibility after rendering. */
interface FilterInputs {
	/** Hovered compatibility; null dims every row and undefined clears dimming. */
	readonly locations: number | null | undefined;
	/** Svelte action dependency that refreshes visibility when rows are rendered again. */
	readonly rows: InventoryEquipment["rows"];
}

/** One presentation owner dims on hover and collapses incompatible rows during dragging. */
class EquipmentStripFilter {
	/** Latest inventory hover, used for dimming only when no drag is active. */
	#hover: number | null | undefined;
	/** Undefined means idle; null suppresses hover during a non-equipment drag. */
	#drag: number | null | undefined;
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

	update(inputs: FilterInputs): void {
		this.#hover = inputs.locations;
		this.#apply(false);
	}

	drag(locations: number | null | undefined): void {
		const changed = this.#drag !== locations;
		this.#drag = locations;
		this.#apply(changed);
	}

	#apply(resetScroll: boolean): void {
		const locations = this.#drag;
		const filtering =
			locations !== undefined && locations !== null && locations !== 0;
		if (filtering && this.#savedScroll === null)
			this.#savedScroll = this.#viewport.scrollTop;
		for (const row of this.node.querySelectorAll<HTMLElement>(
			"[data-equipment-slot]",
		)) {
			const mask = Number(row.dataset.equipmentSlot);
			row.hidden = filtering && (locations & mask) === 0;
			const dimmed =
				this.#drag === undefined &&
				this.#hover !== undefined &&
				(row.dataset.equipmentAvailability !== "available" ||
					this.#hover === null ||
					(this.#hover & mask) === 0);
			if (dimmed) row.dataset.hoverDimmed = "true";
			else delete row.dataset.hoverDimmed;
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

/** Svelte action retains rows and gesture references while collapsing their footprints. */
export function equipmentStripFilter(node: HTMLElement, inputs: FilterInputs) {
	const owner = new EquipmentStripFilter(node);
	strips.set(node, owner);
	owner.update(inputs);
	return {
		update: (next: FilterInputs) => owner.update(next),
		destroy: () => strips.delete(node),
	};
}

/** Undefined ends filtering; null is an active drag without equipment compatibility. */
export function filterDraggedEquipment(
	root: HTMLElement,
	locations: number | null | undefined,
): void {
	for (const node of root.querySelectorAll<HTMLElement>(".equipment-strip"))
		strips.get(node)?.drag(locations);
}
