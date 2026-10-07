import { z } from "zod";

/** Target scope differs from ownership: every list belongs to one local character. */
const scope = z.enum(["account", "character"]);
const coverage = z.enum(["none", "all", "partial"]);
const guid = z.number().int().positive().max(0xffff_ffff);
/** Shared world computes scope eligibility and category coverage once. */
export const squelchSnapshotSchema = z
	.object({
		entries: z.array(
			z
				.object({
					guid,
					name: z.string(),
					account: z.boolean(),
					coverage,
					removalScope: scope.nullable(),
				})
				.strict(),
		),
		legacyAccounts: z.array(z.string()),
		globalCoverage: coverage,
	})
	.strict();
export type SquelchSnapshot = z.infer<typeof squelchSnapshotSchema>;
/** Basic add/remove intents; advanced category/global editing has no mutation API. */
export const squelchActionSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("add"), name: z.string().trim().min(1), scope })
		.strict(),
	z.object({ kind: z.literal("remove"), guid, scope }).strict(),
]);
export type SquelchAction = z.infer<typeof squelchActionSchema>;
/** Replacement events and snapshot recovery share the same record schema. */
export const squelchUpdatedSchema = z
	.object({ squelch: squelchSnapshotSchema.nullable() })
	.strict();
