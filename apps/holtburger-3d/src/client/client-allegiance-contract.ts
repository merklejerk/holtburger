import { z } from "zod";

const guid = z.number().int().positive().max(0xffff_ffff);
const uint = z.number().int().nonnegative().max(0xffff_ffff);
/** Disclosed member facts; XP values are the server's capped report. */
const member = z
	.object({
		guid,
		name: z.string(),
		title: z.string().nullable(),
		rank: uint.max(0xffff),
		level: uint.nullable(),
		online: z.boolean(),
		contributedXp: uint,
	})
	.strict();
export type AllegianceMember = z.infer<typeof member>;
/** Roles and counts are supplied by the shared domain, not reconstructed in UI. */
export const allegianceSnapshotSchema = z
	.object({
		playerGuid: guid.nullable(),
		profile: z
			.object({
				name: z.string(),
				rank: uint,
				totalMembers: uint,
				totalDescendants: uint,
				monarch: member.nullable(),
				patron: member.nullable(),
				selfMember: member.nullable(),
				directVassals: z.array(member),
			})
			.strict()
			.nullable(),
		refreshing: z.boolean(),
		canSwear: z.boolean(),
	})
	.strict();
export type AllegianceSnapshot = z.infer<typeof allegianceSnapshotSchema>;
/** Locally mirrored option, separate from server-confirmed relationship facts. */
export const allegiancePreferencesSchema = z
	.object({ showLogons: z.boolean() })
	.strict();
export type AllegiancePreferences = z.infer<typeof allegiancePreferencesSchema>;
/** Domain intents; server controls swear confirmation. */
export const allegianceActionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("refresh") }).strict(),
	z.object({ kind: z.literal("swear"), guid }).strict(),
	z.object({ kind: z.literal("break"), guid }).strict(),
	z.object({ kind: z.literal("showLogons"), enabled: z.boolean() }).strict(),
]);
export type AllegianceAction = z.infer<typeof allegianceActionSchema>;
/** Events use the same shape as replacement recovery. */
export const allegianceUpdatedSchema = z
	.object({ allegiance: allegianceSnapshotSchema })
	.strict();
