import { z } from "zod";

const guid = z.number().int().positive().max(0xffff_ffff);
/** Character records remain meaningful independently of visible scene entities. */
export const friendsSnapshotSchema = z
	.object({
		members: z.array(
			z.object({ guid, name: z.string(), online: z.boolean() }).strict(),
		),
	})
	.strict();
export type FriendsSnapshot = z.infer<typeof friendsSnapshotSchema>;
/** Core-mirrored preference; publication is not a server acknowledgement. */
export const friendsPreferencesSchema = z
	.object({ appearOffline: z.boolean() })
	.strict();
export type FriendsPreferences = z.infer<typeof friendsPreferencesSchema>;
/** Explicit desired mutations consumed by the narrow host adapter. */
export const friendsActionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("add"), name: z.string().trim().min(1) }).strict(),
	z.object({ kind: z.literal("remove"), guid }).strict(),
	z.object({ kind: z.literal("appearOffline"), enabled: z.boolean() }).strict(),
]);
export type FriendsAction = z.infer<typeof friendsActionSchema>;
/** Incremental transport envelope shares the replacement record schema. */
export const friendsUpdatedSchema = z
	.object({ friends: friendsSnapshotSchema.nullable() })
	.strict();
