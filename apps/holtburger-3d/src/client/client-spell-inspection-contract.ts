import { z } from "zod";

const u32 = z.number().int().nonnegative().max(0xffff_ffff);
/** Caller correlation and spell identity; no gameplay mutation is implied. */
export const spellInspectionQuerySchema = z
	.object({ sequence: u32, spellId: u32.refine((id) => id > 0) })
	.strict();
/** Character-bound invalidation token, independent of window lifetime. */
export const spellInspectionContextSchema = z
	.object({
		revision: z.number().int().nonnegative().safe(),
		player: u32.nullable(),
	})
	.strict();
/** Every reply carries the exact context used for evaluation. */
export const spellInspectionResultSchema = z
	.object({
		sequence: u32,
		spellId: u32,
		context: spellInspectionContextSchema,
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("pending") }).strict(),
			z.object({ kind: z.literal("missing") }).strict(),
			z
				.object({
					kind: z.literal("ready"),
					rangeMetres: z.number().finite(),
					formula: z.discriminatedUnion("kind", [
						z.object({ kind: z.literal("pending") }).strict(),
						z
							.object({
								kind: z.literal("ready"),
								components: z.array(u32).length(8),
							})
							.strict(),
						z
							.object({ kind: z.literal("failed"), detail: z.string().min(1) })
							.strict(),
					]),
				})
				.strict(),
		]),
	})
	.strict();
export type SpellInspectionQuery = z.infer<typeof spellInspectionQuerySchema>;
export type SpellInspectionContext = z.infer<
	typeof spellInspectionContextSchema
>;
export type SpellInspectionResult = z.infer<typeof spellInspectionResultSchema>;
