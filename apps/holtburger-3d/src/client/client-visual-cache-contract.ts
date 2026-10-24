import { z } from "zod";
import {
	playerVisualCaptureSchema,
	type DeepReadonly,
} from "./client-object-preview-contract.js";

/** Optional cache entries have their own version, independent of user settings. */
export const characterVisualFileSchema = z
	.object({
		version: z.literal(1),
		capture: playerVisualCaptureSchema,
	})
	.strict();

/** Failure is local to this character preview and never prevents world entry. */
export const characterVisualReadSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("ready"), capture: playerVisualCaptureSchema })
		.strict(),
	z.object({ kind: z.literal("missing") }).strict(),
	z.object({ kind: z.literal("unavailable"), message: z.string() }).strict(),
]);

export type CharacterVisualRead = DeepReadonly<
	z.infer<typeof characterVisualReadSchema>
>;
