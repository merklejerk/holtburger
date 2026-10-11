import { z } from "zod";

/** Player overrides are independent of theme defaults and developer animation policy. */
export const COMBAT_INDICATOR_SIZE_RANGE = {
	minimum: 16,
	maximum: 56,
} as const;
const color = z
	.string()
	.regex(/^#[\da-f]{6}$/i)
	.nullable();
export const clientCombatIndicatorSettingsSchema = z
	.object({
		/** Null follows the active theme's CSS pixel size. */
		fontSize: z
			.number()
			.int()
			.min(COMBAT_INDICATOR_SIZE_RANGE.minimum)
			.max(COMBAT_INDICATOR_SIZE_RANGE.maximum)
			.nullable(),
		/** Null follows the theme; avoidance covers both MISS and RESIST. */
		colors: z
			.object({ damage: color, critical: color, avoidance: color })
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();
export type ClientCombatIndicatorSettings = z.infer<
	typeof clientCombatIndicatorSettingsSchema
>;
export const CLIENT_COMBAT_INDICATOR_DEFAULTS = {
	fontSize: null,
	colors: { damage: null, critical: null, avoidance: null },
} as const satisfies ClientCombatIndicatorSettings;
