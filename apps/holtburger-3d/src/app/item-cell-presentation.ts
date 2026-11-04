import type { ItemCapacity } from "./item-capacity";
import { formatQuantity } from "./quantity-format";
import { itemStructureDisplay, type ItemStructure } from "./item-structure";

/** Item facts needed by both inventory and bound-action cells. */
export interface ItemCellFacts {
	/** Remaining time sampled at the cell label's bounded reading cadence. */
	readonly cooldownSeconds?: number;
	/** Base accessible name, including any caller-owned slot context. */
	readonly label: string;
	/** Stack quantity; null when absent or unknown. */
	readonly count: number | null;
	/** Consumer-owned action hint displayed on its own line after a stack quantity. */
	readonly quantityActionHint?: string | null;
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
	/** Item identity followed by one line per status or action hint. */
	readonly label: string;
	/** Visible stack quantity, omitted for single items. */
	readonly count: number | null;
	/** Remaining structure or occupied container space; empty containers hide the track. */
	readonly meter: ItemCellMeter | null;
	/** Whether to draw the equipped marker. */
	readonly equipped: boolean;
}

/** Compose item status once for visual indicators, accessible names and cell tooltips. */
export function itemCellPresentation(
	facts: ItemCellFacts,
): ItemCellPresentation {
	const count = facts.count !== null && facts.count > 1 ? facts.count : null;
	const lines = [facts.label];
	let meter: ItemCellMeter | null = null;
	if (count !== null) {
		lines.push(`Quantity: ${formatQuantity(count)}`);
		if (facts.quantityActionHint) lines.push(facts.quantityActionHint);
	}
	const capacity = facts.capacity;
	if (capacity !== null) {
		lines.push(
			`Contents: [${formatQuantity(capacity.used)} / ${formatQuantity(capacity.max)}]`,
		);
		if (capacity.used > 0) {
			// Occupancy at or above a zero limit is full, without dividing by zero.
			const fraction =
				capacity.max === 0 ? 1 : Math.min(1, capacity.used / capacity.max);
			meter = { fraction, hue: (1 - fraction) * 120 };
		}
	} else {
		const structure = itemStructureDisplay(facts.structure);
		if (structure !== null) {
			lines.push(`Structure: ${structure.label}`);
			meter = { fraction: structure.fraction, hue: structure.fraction * 120 };
		}
	}
	if (facts.equipped) lines.push("Equipped");
	if (facts.cooldownSeconds !== undefined && facts.cooldownSeconds > 0)
		lines.push(`Ready in ${facts.cooldownSeconds}s; shared cooldown`);
	return { label: lines.join("\n"), count, meter, equipped: facts.equipped };
}
