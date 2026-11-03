import { z } from "zod";
import { releaseVersionSchema } from "./app-build-contract.js";

/** Candidate identity stays within one fixed repository's release URL namespace. */
const updateTagSchema = z.string().regex(/^candidate-\d{8}-[0-9a-f]{7,40}$/);

/** Small public Pages document projected from a complete published release manifest. */
export const updateFeedSchema = z
	.object({
		/** Feed format, independent of application release versions. */
		schemaVersion: z.literal(1),
		/** Only main compares this canonical SemVer with the running build. */
		version: releaseVersionSchema,
		/** Identifies the confirmed downloads page without accepting arbitrary URLs. */
		tag: updateTagSchema,
	})
	.strict();

/** Validated feed document consumed only by the native comparison owner. */
export type UpdateFeed = z.infer<typeof updateFeedSchema>;

/** Native navigation can retire a footer before its final visibility/cleanup IPC arrives. */
export const pregameRegistrationStatusSchema = z.enum(["active", "retired"]);

/** Retired lifecycle acknowledgements cannot mutate a replacement document's registrations. */
export type PregameRegistrationStatus = z.infer<
	typeof pregameRegistrationStatusSchema
>;

/** Native availability is retained independently of a later failed check. */
const updateAvailabilitySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unknown") }).strict(),
	z.object({ kind: z.literal("current") }).strict(),
	z
		.object({
			kind: z.literal("available"),
			/** Version used in the footer's accessible label and tooltip. */
			version: releaseVersionSchema,
			/** Confirmed release identity retained by the native browser opener. */
			tag: updateTagSchema,
		})
		.strict(),
]);

/** Cold native state, ordered across initial IPC responses and asynchronous events. */
export const updateSnapshotSchema = z
	.object({
		/** Transport discards out-of-order or duplicate publications. */
		revision: z.number().int().nonnegative(),
		/** The renderer presents this decision without repeating version comparison. */
		availability: updateAvailabilitySchema,
		/** Observed check failure; native logging consumes it without interrupting play. */
		diagnostic: z.string().nullable(),
	})
	.strict();

/** A main-owned update decision shared by the launcher and pregame documents. */
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>;
