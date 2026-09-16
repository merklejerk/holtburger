import type { InputDigitIndex } from "../lib/input/input-contract";

/** Fixed positions displayed as 1–9, then 0. */
export const SPELL_BAR_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Exact ten-position collection; empty bindings retain their address. */
type Ten<T> = readonly [T, T, T, T, T, T, T, T, T, T];
/** A stable cell address captured at gesture start. */
export interface SpellCellAddress {
	/** Zero-based fixed bar identity. */
	readonly tab: InputDigitIndex;
	/** Zero-based position within that bar. */
	readonly slot: InputDigitIndex;
}
/** Session-local configuration, independent of visibility and loaded artwork. */
export interface ClientSpellBarState {
	/** Tab presented by the HUD and addressed by digit activation. */
	readonly selected: InputDigitIndex;
	/** Stable addresses containing only spell IDs, never prepared display data. */
	readonly tabs: Ten<Ten<number | null>>;
}
/** Create ten independent empty tabs with the first selected. */
export function initialSpellBar(): ClientSpellBarState {
	const empty = (): Ten<number | null> => [
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
	];
	return {
		selected: 0,
		tabs: [
			empty(),
			empty(),
			empty(),
			empty(),
			empty(),
			empty(),
			empty(),
			empty(),
			empty(),
			empty(),
		],
	};
}
/** Replace one position without weakening the fixed-length contract. */
function replace<T>(values: Ten<T>, index: InputDigitIndex, value: T): Ten<T> {
	const result: [T, T, T, T, T, T, T, T, T, T] = [...values];
	result[index] = value;
	return result;
}
/** Bind or clear one exact address; other tabs retain their identities. */
export function bindSpellCell(
	state: ClientSpellBarState,
	address: SpellCellAddress,
	spell: number | null,
): ClientSpellBarState {
	return {
		...state,
		tabs: replace(
			state.tabs,
			address.tab,
			replace(state.tabs[address.tab], address.slot, spell),
		),
	};
}
/** Swap includes moving into an empty cell and dropping onto the source. */
export function swapSpellCells(
	state: ClientSpellBarState,
	source: SpellCellAddress,
	target: SpellCellAddress,
): ClientSpellBarState {
	const spell = state.tabs[source.tab][source.slot];
	return bindSpellCell(
		bindSpellCell(state, source, state.tabs[target.tab][target.slot]),
		target,
		spell,
	);
}
