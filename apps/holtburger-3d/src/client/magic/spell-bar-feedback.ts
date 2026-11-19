import { pulseItemCell } from "../../app/item-cell-pulse";
import type { SpellCellAddress } from "./spell-bar-state";

/** Give accepted mouse and keyboard activations the same mounted-cell feedback.
 * A null address identifies the equipped weapon spell; unmounted cells have no visual feedback.
 */
export function pulseSpellBarCell(
	root: HTMLElement,
	address: SpellCellAddress | null,
): void {
	const selector =
		address === null
			? "[data-caster-spell] .spell-cell"
			: `[data-spell-tab="${address.tab}"][data-spell-cell="${address.slot}"]`;
	const cell = root.querySelector<HTMLElement>(selector);
	if (cell !== null) pulseItemCell(cell, "interaction");
}
