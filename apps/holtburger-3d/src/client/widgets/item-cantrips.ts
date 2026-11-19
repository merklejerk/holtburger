import { getContext, setContext } from "svelte";
import type { RankedCantripTier } from "./item-cantrip-contract.js";

const ITEM_CANTRIPS = Symbol("app-item-cantrips");

/** Reactive equipment cantrip lookup shared across item and action cells in one client tree. */
export interface ItemCantripLookup {
	tierFor(guid: number | null): RankedCantripTier | undefined;
}

const EMPTY_LOOKUP: ItemCantripLookup = {
	tierFor: () => undefined,
};

/** Provide one mounted client tree's equipment cantrip tier lookup. */
export function provideItemCantrips(
	lookup: ItemCantripLookup,
): ItemCantripLookup {
	return setContext(ITEM_CANTRIPS, lookup);
}

/** Read the mounted client tree's cantrip tier lookup, falling back empty outside client trees. */
export function useItemCantrips(): ItemCantripLookup {
	return (
		getContext<ItemCantripLookup | undefined>(ITEM_CANTRIPS) ?? EMPTY_LOOKUP
	);
}
