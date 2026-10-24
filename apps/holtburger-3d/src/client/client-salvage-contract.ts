import { z } from "zod";

const guid = z.number().int().min(0).max(0xffff_ffff);
const instance = z.number().int().min(0).max(0xffff);

/** World-normalized yield inputs; the browser never calculates salvage yields. */
const salvageSkillsSchema = z
	.object({
		salvagingSkill: guid,
		tinkeringSkill: guid,
		augmentationBonusSalvage: guid,
	})
	.strict();
/** Yield profile, independent of per-item admission. */
export const salvageContextSchema = z
	.object({
		skills: salvageSkillsSchema,
	})
	.strict();
/** Server incarnation makes a recycled tool identity invalidate review. */
const toolSchema = z.object({ guid, instance }).strict();
/** Opaque normalized predictor input, forwarded unchanged in a reviewed submission. */
const inputSchema = z
	.object({
		itemType: guid,
		materialType: z.string(),
		stackSize: guid,
		structure: guid,
		itemWorkmanship: guid,
		numItemsInMaterial: guid.positive(),
	})
	.strict();
/** Ordered whole-item source, consumed by queue dependency checks and guarded submission. */
const sourceSchema = z.object({ guid, instance, input: inputSchema }).strict();
/** Public candidate admission is available before the full appraisal needed for prediction. */
export const salvageCandidateSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ineligible"), reason: z.string() }).strict(),
	z
		.object({ kind: z.literal("pending-details"), material: z.string() })
		.strict(),
	z.object({ kind: z.literal("ready"), source: sourceSchema }).strict(),
]);
/** Semantic execution precondition, constructed by world and re-evaluated in core. */
const reviewSchema = z
	.object({
		player: guid,
		tool: toolSchema,
		sources: z.array(sourceSchema),
		skills: salvageSkillsSchema,
	})
	.strict();
/** Estimated individual output bags; no rows are applied to inventory optimistically. */
const bagSchema = z
	.object({
		materialType: z.string(),
		units: guid,
		workmanship: z.number().finite().nonnegative(),
	})
	.strict();
/** Empty previews may open a window; pending details never silently omit source items. */
const salvageEvaluationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("ready"),
			review: reviewSchema,
			bags: z.array(bagSchema),
		})
		.strict(),
	z
		.object({
			kind: z.literal("pending-details"),
			tool: toolSchema,
			items: z.array(guid),
		})
		.strict(),
	z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
]);
/** Discovery and proposed batch evaluation share one correlated request. */
export const salvagePreviewRequestSchema = z
	.object({
		sequence: guid,
		player: guid,
		tool: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("exact"), guid }).strict(),
			z
				.object({ kind: z.literal("discover"), preferred: guid.nullable() })
				.strict(),
		]),
		items: z.array(guid),
	})
	.strict();
/** Command enqueue acceptance is separate from this evaluation event. */
export const salvagePreviewResultSchema = z
	.object({ sequence: guid, evaluation: salvageEvaluationSchema })
	.strict();
/** Submit the immutable world-produced review, never mutable selection. */
export const salvageSubmitRequestSchema = z
	.object({ sequence: guid, review: reviewSchema })
	.strict();
/** Local dispatch receipt; optional server result packets never control frontend draft lifetime. */
export const salvageSubmitResultSchema = z
	.object({
		sequence: guid,
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("dispatched") }).strict(),
			z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
			z
				.object({
					kind: z.literal("changed"),
					evaluation: salvageEvaluationSchema,
				})
				.strict(),
		]),
	})
	.strict();
export type SalvageContext = z.infer<typeof salvageContextSchema>;
export type SalvageEvaluation = z.infer<typeof salvageEvaluationSchema>;
export type SalvageReview = z.infer<typeof reviewSchema>;
export type SalvagePreviewRequest = z.infer<typeof salvagePreviewRequestSchema>;
export type SalvagePreviewResult = z.infer<typeof salvagePreviewResultSchema>;
export type SalvageSubmitRequest = z.infer<typeof salvageSubmitRequestSchema>;
export type SalvageSubmitResult = z.infer<typeof salvageSubmitResultSchema>;
