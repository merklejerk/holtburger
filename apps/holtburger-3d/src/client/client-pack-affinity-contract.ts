import { z } from "zod";

const guid = z.number().int().positive().max(0xffff_ffff);
const guidKey = z
	.string()
	.regex(/^[1-9][0-9]*$/)
	.refine((value) => Number(value) <= 0xffff_ffff, {
		message: "Item GUID exceeds the unsigned 32-bit range",
	});

/** Character-local last observed carried container for each item instance. */
export const packAffinitiesSchema = z.record(guidKey, guid).readonly();
export type PackAffinities = z.infer<typeof packAffinitiesSchema>;

/** Caller-owned destinations; core validates ownership and allocates shared capacity. */
export interface EquipmentStoragePolicy {
	/** Remembered containers for currently equipped items; core discovers actual conflicts. */
	readonly preferred: PackAffinities;
	/** Main Pack followed by directly carried real bags in native order. */
	readonly fallback: readonly number[];
}
