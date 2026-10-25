import { z } from "zod";

/** World-produced definition shared by entity facts and appraisal. */
export const itemCooldownDefinitionSchema = z
	.object({
		groupId: z.number().int().positive().max(0xffff_ffff).nullable(),
		durationSeconds: z.number().finite().nullable(),
	})
	.strict()
	.readonly();

/** Finite group countdown sampled with the enclosing enchantment snapshot. */
export const groupCooldownSchema = z
	.object({
		groupId: z.number().int().min(0).max(0x7fff),
		remainingSeconds: z.number().finite().nonnegative(),
	})
	.strict();
