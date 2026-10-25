import { z } from "zod";

/** App-local content diagnostics shared by stdio, native preferences, and startup UI. */
export const contentFailureSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("selection"),
		reason: z.enum(["absent", "empty", "invalid"]),
		message: z.string(),
	}),
	z.object({
		kind: z.literal("resource"),
		namespace: z.string(),
		file_id: z.number().int().nonnegative().max(0xffff_ffff),
		source: z.string().nullable(),
		message: z.string(),
	}),
	z.object({ kind: z.literal("integrity"), message: z.string() }),
]);

/** A necessary content failure, classified before native persistence or presentation. */
export type ContentFailure = z.infer<typeof contentFailureSchema>;

/** Native-owned startup state; revisions prevent initial snapshot delivery from rolling back UI. */
export const contentStartupSnapshotSchema = z.object({
	revision: z.number().int().nonnegative(),
	temporary: z.boolean(),
	phase: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("loading"),
			location: z.string().nullable(),
			message: z.string(),
		}),
		z.object({
			kind: z.literal("needs_assets"),
			/** Folder browsing keeps setup visible and prevents duplicate actions. */
			choosing: z.boolean(),
			/** Native retry admission: a selected path or allowed automatic discovery. */
			canRetry: z.boolean(),
			location: z.string().nullable(),
			/** Null for ordinary setup; actual failures retain their full diagnostic. */
			message: z.string().nullable(),
		}),
		z.object({ kind: z.literal("persistence_failed"), message: z.string() }),
		z.object({ kind: z.literal("ready"), location: z.string() }),
		z.object({
			kind: z.literal("restart_required"),
			location: z.string(),
			message: z.string(),
		}),
		z.object({ kind: z.literal("fatal"), message: z.string() }),
	]),
});

/** Cold lifecycle facts exposed to the styled setup shell. */
export type ContentStartupSnapshot = z.infer<
	typeof contentStartupSnapshotSchema
>;
/** One lifecycle state published by the native coordinator. */
export type ContentStartupPhase = ContentStartupSnapshot["phase"];
