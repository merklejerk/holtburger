import { z } from "zod";
import {
	releaseChangelogSchema,
	releaseChangelogsSchema,
} from "./release-history-contract.js";

/** Native navigation can retire a footer before its final visibility/cleanup IPC arrives. */
export const pregameRegistrationStatusSchema = z.enum(["active", "retired"]);

/** Retired lifecycle acknowledgements cannot mutate a replacement document's registrations. */
export type PregameRegistrationStatus = z.infer<
	typeof pregameRegistrationStatusSchema
>;

/** Native selection is retained independently of later request failures. */
const updateAvailabilitySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unknown") }).strict(),
	z
		.object({
			kind: z.literal("current"),
			/** An up-to-date client presents only the latest published release's notes. */
			releases: z.tuple([releaseChangelogSchema]),
		})
		.strict(),
	z
		.object({
			kind: z.literal("available"),
			/** First entry is the confirmed download target and newest displayed release. */
			releases: releaseChangelogsSchema,
			/** At least one newer release lies outside the retained history. */
			historyIncomplete: z.boolean(),
		})
		.strict(),
]);

/** Request state is independent of the last successful release selection. */
const updateCheckSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.enum(["idle", "loading", "ready", "disabled"]) }).strict(),
	z
		.object({
			kind: z.literal("failed"),
			/** Observable failure shown on explicit modal inspection. */
			message: z.string().min(1),
		})
		.strict(),
]);

/** Cold native state, ordered across initial IPC responses and asynchronous events. */
export const updateSnapshotSchema = z
	.object({
		/** Transport discards out-of-order or duplicate publications. */
		revision: z.number().int().nonnegative(),
		/** Loading, retry, and disabled presentation never discard confirmed notes. */
		check: updateCheckSchema,
		/** The renderer presents this decision without repeating version comparison. */
		availability: updateAvailabilitySchema,
	})
	.strict();

/** A main-owned update decision shared by the launcher and pregame documents. */
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>;
