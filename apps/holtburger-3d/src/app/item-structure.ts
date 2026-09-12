import { formatItemQuantity } from "./item-quantity";

/** Server structure properties; either value may be absent independently. */
export interface ItemStructure {
	/** Remaining uses/structure, including zero for exhausted items. */
	readonly current: number | null;
	/** Full capacity, absent until the server supplies it. */
	readonly max: number | null;
}

/** Shared presentation decision for icon bars, tooltips, and selected names. */
export interface ItemStructureDisplay {
	/** Exact grouped values in brackets, appended to the item label. */
	readonly label: string;
	/** Bounded remaining fraction used for both bar height and color. */
	readonly fraction: number;
}

/** Full or incomplete structure properties have no indicator. */
export function itemStructureDisplay(
	structure: ItemStructure | null,
): ItemStructureDisplay | null {
	if (
		structure === null ||
		structure.current === null ||
		structure.max === null ||
		structure.current === structure.max
	)
		return null;
	return {
		label: `[${formatItemQuantity(structure.current)}/${formatItemQuantity(structure.max)}]`,
		// A zero capacity cannot define a ratio; keep its exact label and draw an empty bar.
		fraction:
			structure.max === 0
				? 0
				: Math.max(0, Math.min(1, structure.current / structure.max)),
	};
}
