import { z } from "zod";

/** Shared optional content capability reported by either host mode. */
export const weenieCatalogCapabilitySchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("available"),
		path: z.string(),
		recordCount: z.number().int().nonnegative(),
	}),
	z.object({
		status: z.literal("unavailable"),
		path: z.string().nullable(),
		kind: z.enum(["missing-content-location", "missing", "invalid"]),
		reason: z.string(),
	}),
]);

/** Validated catalog availability for cold UI diagnostics. */
export type WeenieCatalogCapability = z.infer<
	typeof weenieCatalogCapabilitySchema
>;

/** Decode the shared content capability before changing UI state. */
export function decodeWeenieCatalogCapability(
	value: unknown,
): WeenieCatalogCapability {
	return weenieCatalogCapabilitySchema.parse(value);
}
