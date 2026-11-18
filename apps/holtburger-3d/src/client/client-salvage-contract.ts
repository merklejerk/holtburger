import { z } from "zod";

const guid = z.number().int().min(0).max(0xffff_ffff);

/** Public candidate admission is available before the full appraisal needed for prediction. */
export const salvageCandidateSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ineligible"), reason: z.string() }).strict(),
	z
		.object({ kind: z.literal("pending-details"), material: z.string() })
		.strict(),
	z.object({ kind: z.literal("ready"), material: z.string() }).strict(),
]);
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
			revision: guid,
			tool: guid,
			bags: z.array(bagSchema),
		})
		.strict(),
	z
		.object({
			kind: z.literal("pending-details"),
			tool: guid,
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
/** Submit the authority-retained preview revision, never an echoed review payload. */
export const salvageSubmitRequestSchema = z
	.object({ sequence: guid, revision: guid })
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
export type SalvageEvaluation = z.infer<typeof salvageEvaluationSchema>;
export type SalvagePreviewRequest = z.infer<typeof salvagePreviewRequestSchema>;
export type SalvagePreviewResult = z.infer<typeof salvagePreviewResultSchema>;
export type SalvageSubmitRequest = z.infer<typeof salvageSubmitRequestSchema>;
export type SalvageSubmitResult = z.infer<typeof salvageSubmitResultSchema>;
