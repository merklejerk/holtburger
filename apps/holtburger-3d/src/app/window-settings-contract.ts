import { z } from "zod";

/** Native window state is available before renderer settings bootstrap. */
export const clientWindowSettingsSchema = z
	.object({
		normalBounds: z
			.object({
				width: z.number().int().positive().safe(),
				height: z.number().int().positive().safe(),
			})
			// Discard retired position fields when reading existing settings.
			.strip()
			.readonly(),
		maximized: z.boolean(),
	})
	.strict()
	.readonly();
export type ClientWindowSettings = z.infer<typeof clientWindowSettingsSchema>;
