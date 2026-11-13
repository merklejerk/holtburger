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

/** Runtime validation for an equipment border tier. */
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

/** Intrinsic cantrip knowledge received from the world authority. */
export type EquipmentCantripState = z.infer<typeof equipmentCantripStateSchema>;
