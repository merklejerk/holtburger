import { getContext, setContext } from "svelte";
import { z } from "zod";
import type { CantripTier } from "./spell-references.js";

/** Ordered lowest-to-highest cantrip tiers eligible for equipment border ranking. */
const RANKED_CANTRIP_TIERS = [
	"feeble",
	"minor",
	"moderate",
	"major",
	"epic",
	"legendary",
] as const satisfies readonly CantripTier[];

export const rankedCantripTierSchema = z.enum(RANKED_CANTRIP_TIERS);

/** Ranked cantrip tier displayed on equipment borders (excludes `"other"`). */
export type RankedCantripTier = z.infer<typeof rankedCantripTierSchema>;

/** World-derived intrinsic equipment cantrip state shared by entities and vendor offers. */
export const equipmentCantripStateSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("unappraised") })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("incomplete") })
		.strict()
		.readonly(),
	z
		.object({
			kind: z.literal("known"),
			highestTier: rankedCantripTierSchema.nullable(),
		})
		.strict()
		.readonly(),
]);

export type EquipmentCantripState = z.infer<typeof equipmentCantripStateSchema>;

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
