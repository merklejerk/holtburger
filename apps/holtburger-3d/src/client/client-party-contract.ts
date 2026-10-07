import { z } from "zod";

/** ACE's fellowship capacity (Entity/Fellowship.cs:26); used for recruitment presentation. */
export const PARTY_MEMBER_LIMIT = 9;

const guid = z.number().int().positive().max(0xffff_ffff);
const u32 = z.number().int().nonnegative().max(0xffff_ffff);
/** Membership facts retained imperatively; vitals never enter the management reactive graph. */
export const partySnapshotSchema = z
	.object({
		name: z.string(),
		leader: guid.nullable(),
		shareXp: z.boolean(),
		evenShare: z.boolean(),
		open: z.boolean(),
		locked: z.boolean(),
		members: z.array(
			z
				.object({
					guid,
					name: z.string(),
					level: u32,
					vitals: z.tuple([u32, u32, u32, u32, u32, u32]),
				})
				.strict(),
		),
	})
	.strict();
export type PartySnapshot = z.infer<typeof partySnapshotSchema>;
/** Core mirrors these preferences after transport acceptance, without a server acknowledgement. */
export const partyPreferencesSchema = z
	.object({
		shareXp: z.boolean(),
		shareLoot: z.boolean(),
		ignoreRequests: z.boolean(),
	})
	.strict();
export type PartyPreferences = z.infer<typeof partyPreferencesSchema>;
/** Explicit requested effects, independent of stale checkbox values. */
export const partyActionSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("create"), name: z.string().trim().min(1) })
		.strict(),
	...(["invite", "dismiss", "promote"] as const).map((kind) =>
		z.object({ kind: z.literal(kind), target: guid }).strict(),
	),
	z.object({ kind: z.literal("leave") }).strict(),
	z.object({ kind: z.literal("disband") }).strict(),
	z.object({ kind: z.literal("openness"), open: z.boolean() }).strict(),
	...(["shareXp", "shareLoot", "ignoreRequests"] as const).map((kind) =>
		z.object({ kind: z.literal(kind), enabled: z.boolean() }).strict(),
	),
]);
export type PartyAction = z.infer<typeof partyActionSchema>;
