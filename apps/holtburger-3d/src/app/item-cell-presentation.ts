import type { ItemCapacity } from "./item-capacity";
import { formatItemQuantity } from "./item-quantity";
import { itemStructureDisplay, type ItemStructure } from "./item-structure";

/** Item facts needed by both inventory and bound-action cells. */
export interface ItemCellFacts {
	/** Base accessible name, including any caller-owned slot context. */
	readonly label: string;
	/** Stack quantity; null when absent or unknown. */
	readonly count: number | null;
	/** Remaining uses or durability supplied by the server. */
	readonly structure: ItemStructure | null;
	/** Known container occupancy; takes precedence over structure. */
	readonly capacity: ItemCapacity | null;
	/** Confirmed equipment location, never optimistic command state. */
	readonly equipped: boolean;
}

/** Meter geometry and color are independent: uses drain, container occupancy fills. */
interface ItemCellMeter {
	/** Bounded fraction of the vertical track to fill. */
	readonly fraction: number;
	/** HSL hue from red (0) to green (120). */
	readonly hue: number;
}

/** One presentation decision shared by artwork, overlays, and accessible labels. */
export interface ItemCellPresentation {
	/** Complete item label before control-specific hints. */
	readonly label: string;
	/** Visible stack quantity, omitted for single items. */
	readonly count: number | null;
	/** Remaining structure or occupied container space; empty containers hide the track. */
	readonly meter: ItemCellMeter | null;
	/** Whether to draw the equipped marker. */
	readonly equipped: boolean;
}

/** Compose item status once so icon diagnostics and button tooltips cannot disagree. */
export function itemCellPresentation(
	facts: ItemCellFacts,
): ItemCellPresentation {
	const count = facts.count !== null && facts.count > 1 ? facts.count : null;
	let label = facts.label;
	let meter: ItemCellMeter | null = null;
	if (count !== null) label += ` (quantity: ${formatItemQuantity(count)})`;
	const capacity = facts.capacity;
	if (capacity !== null) {
		label += ` [${formatItemQuantity(capacity.used)} / ${formatItemQuantity(capacity.max)}]`;
		if (capacity.used > 0) {
			// Occupancy at or above a zero limit is full, without dividing by zero.
			const fraction =
				capacity.max === 0 ? 1 : Math.min(1, capacity.used / capacity.max);
			meter = { fraction, hue: (1 - fraction) * 120 };
		}
	} else {
		const structure = itemStructureDisplay(facts.structure);
		if (structure !== null) {
			label += ` ${structure.label}`;
			meter = { fraction: structure.fraction, hue: structure.fraction * 120 };
		}
	}
	if (facts.equipped) label += " (Equipped)";
	return { label, count, meter, equipped: facts.equipped };
}
