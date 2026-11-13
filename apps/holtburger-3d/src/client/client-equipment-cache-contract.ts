import { z } from "zod";
import { rankedCantripTierSchema } from "../app/item-cantrip-contract.js";

const equipmentCacheTierSchema = rankedCantripTierSchema.nullable();

/** Cached per-equipment cantrip verdict (`null` records appraised gear with no ranked cantrip). */
export type EquipmentCacheTier = z.infer<typeof equipmentCacheTierSchema>;

const equipmentGuidSchema = z.number().int().positive().max(0xffff_ffff);

export const equipmentCacheStageSchema = z
	.object({
		guid: equipmentGuidSchema,
		highestTier: equipmentCacheTierSchema,
	})
	.strict()
	.readonly();

/** Single equipment cantrip verdict staged from renderer appraisal results. */
export type EquipmentCacheEntry = z.infer<typeof equipmentCacheStageSchema>;

const equipmentGuidKeySchema = z.string().regex(/^[1-9][0-9]*$/);

export const equipmentCacheSnapshotSchema = z.record(
	equipmentGuidKeySchema,
	equipmentCacheTierSchema,
);

/** Map of decimal string GUID to cached highest cantrip tier (`null` when confirmed none). */
export type EquipmentCacheSnapshot = z.infer<
	typeof equipmentCacheSnapshotSchema
>;

export const equipmentCacheTupleSchema = z.tuple([
	equipmentGuidSchema,
	equipmentCacheTierSchema,
]);
