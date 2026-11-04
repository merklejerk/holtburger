import { z } from "zod";

/** Target-local evidence, with no claim about which player caused it. */
export const lockFeedbackSchema = z
	.object({
		target: z.number().int().nonnegative().max(0xffff_ffff),
		generation: z.number().int().nonnegative(),
		worldGeneration: z.number().int().nonnegative(),
		outcome: z.enum(["unlocked", "failed"]),
	})
	.strict();
/** Core-owned interpretation, qualified by object and world lifetime. */
export type ClientLockFeedback = z.infer<typeof lockFeedbackSchema>;
