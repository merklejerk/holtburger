import { z } from "zod";

/** Native window state is available before renderer settings bootstrap. */
export const clientWindowSettingsSchema = z
	.object({
		/** Native outer window dimensions; retained separately from content-size presets. */
		normalBounds: z
			.object({
				width: z.number().int().positive().safe(),
				height: z.number().int().positive().safe(),
			})
			// Discard retired position fields when reading existing settings.
			.strip()
			.readonly(),
		maximized: z.boolean(),
		/** Client-only native chrome preference; the launcher always has its title bar. */
		borderless: z.boolean().default(false),
		/** Native fullscreen preference; older installations start windowed. */
		fullscreen: z.boolean().default(false),
		/** Allow edge resizing and maximizing independently of preset selection. */
		freeResize: z.boolean().default(true),
	})
	.strict()
	.readonly();
export type ClientWindowSettings = z.infer<typeof clientWindowSettingsSchema>;
