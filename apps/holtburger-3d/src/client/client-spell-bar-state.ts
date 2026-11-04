import type { InputDigitIndex } from "../lib/input/input-contract";

/** The ten numbered positions remain the only keyboard-addressable cells. */
export const SPELL_BAR_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Ten tab identities; each tab may grow beyond its ten numbered cells. */
type Ten<T> = readonly [T, T, T, T, T, T, T, T, T, T];
/** A stable cell address captured at gesture start. */
export interface SpellCellAddress {
	/** Zero-based fixed tab identity. */
	readonly tab: InputDigitIndex;
	/** Zero-based position within the tab, including unnumbered overflow cells. */
	readonly slot: number;
}
/** Character-scoped bindings, independent of visibility, selection, and loaded artwork. */
export interface ClientSpellBarBindings {
	/** Stable addresses containing only spell IDs, never prepared display data. */
	readonly tabs: Ten<readonly (number | null)[]>;
}

/** Session-local presentation composed with durable character bindings. */
export interface ClientSpellBarState extends ClientSpellBarBindings {
	/** Ephemeral tab presented by the HUD and addressed by digit activation. */
	readonly selected: InputDigitIndex;
}

/** Keep numbered cells and one empty destination after the last occupied cell. */
export function normalizeSpellTab(
	tab: readonly (number | null)[],
): readonly (number | null)[] {
	let lastOccupied = tab.length - 1;
	while (lastOccupied >= 0 && tab[lastOccupied] === null) lastOccupied--;
	const length = Math.max(SPELL_BAR_INDICES.length, lastOccupied + 2);
	return Array.from({ length }, (_, slot) => tab[slot] ?? null);
}

/** Create ten independent empty character-scoped binding tabs. */
export function initialSpellBarBindings(): ClientSpellBarBindings {
	const empty = () => SPELL_BAR_INDICES.map(() => null);
	return {
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

/** Compose empty bindings with the first ephemeral tab selected. */
export function initialSpellBar(): ClientSpellBarState {
	return { selected: 0, ...initialSpellBarBindings() };
}

/** Replace one tab while preserving its fixed identity. */
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
	const tab = state.tabs[address.tab];
	if (
		!Number.isSafeInteger(address.slot) ||
		address.slot < 0 ||
		address.slot >= tab.length
	)
		throw new Error(`Invalid spell cell ${address.tab}:${address.slot}`);
	const changed = [...tab];
	changed[address.slot] = spell;
	return {
		...state,
		tabs: replace(state.tabs, address.tab, normalizeSpellTab(changed)),
	};
}

/** Swap atomically so trimming cannot remove a destination between assignments. */
export function swapSpellCells(
	state: ClientSpellBarState,
	source: SpellCellAddress,
	target: SpellCellAddress,
): ClientSpellBarState {
	if (source.tab === target.tab && source.slot === target.slot) return state;
	const sourceTab = state.tabs[source.tab];
	const targetTab = state.tabs[target.tab];
	if (
		!Number.isSafeInteger(source.slot) ||
		source.slot < 0 ||
		source.slot >= sourceTab.length ||
		!Number.isSafeInteger(target.slot) ||
		target.slot < 0 ||
		target.slot >= targetTab.length
	)
		throw new Error("Invalid spell cell swap address");
	const changedSource = [...sourceTab];
	const changedTarget =
		source.tab === target.tab ? changedSource : [...targetTab];
	changedSource[source.slot] = targetTab[target.slot];
	changedTarget[target.slot] = sourceTab[source.slot];
	let tabs = replace(state.tabs, source.tab, normalizeSpellTab(changedSource));
	if (source.tab !== target.tab)
		tabs = replace(tabs, target.tab, normalizeSpellTab(changedTarget));
	return { ...state, tabs };
}
