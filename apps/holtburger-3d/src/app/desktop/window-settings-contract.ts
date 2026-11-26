import { z } from "zod";
import { windowContentSizeSchema } from "./window-display-contract.js";

/** Native window state is available before renderer settings bootstrap. */
export const clientWindowSettingsSchema = z
	.object({
		/** Windowed viewport dimensions in CSS pixels, excluding native window decorations. */
		contentSize: windowContentSizeSchema,
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
