import { z } from "zod";

const id = z.number().int().nonnegative().max(0xffff_ffff);
/** Lossless source position in AC's landblock-local axes; cell identity is preserved. */
const positionSchema = z
	.object({
		landblockId: id,
		coords: z
			.object({
				x: z.number().finite(),
				y: z.number().finite(),
				z: z.number().finite(),
			})
			.strict(),
		rotation: z
			.object({
				w: z.number().finite(),
				x: z.number().finite(),
				y: z.number().finite(),
				z: z.number().finite(),
			})
			.strict(),
	})
	.strict();
const remainingSeconds = z.number().finite().positive();
/** Shared destination facts; indoor entries do not imply an outdoor entrance. */
const contractLocationSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("missing") }).strict(),
	z.object({ kind: z.literal("indoor"), cellId: id }).strict(),
	z
		.object({
			kind: z.literal("outdoor"),
			latitude: z.number().finite(),
			longitude: z.number().finite(),
			position: positionSchema,
		})
		.strict(),
]);
/** Stages already interpreted by shared world semantics. */
const contractStatusSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("available") }).strict(),
	z
		.object({ kind: z.literal("inProgress"), progress: z.string().nullable() })
		.strict(),
	z.object({ kind: z.literal("completed") }).strict(),
	z.object({ kind: z.literal("waitingToRepeat"), remainingSeconds }).strict(),
]);
const deadlineSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("finished") }).strict(),
	z.object({ kind: z.literal("running"), remainingSeconds }).strict(),
]);
/** Missing definitions remain visible/removable rather than silently disappearing. */
const contractRowSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unresolved"), id }).strict(),
	z
		.object({
			kind: z.literal("resolved"),
			id,
			name: z.string(),
			description: z.string(),
			status: contractStatusSchema,
			contact: z
				.object({
					role: z.enum(["start", "end"]),
					name: z.string(),
					location: contractLocationSchema,
				})
				.strict()
				.nullable(),
			area: contractLocationSchema,
			deadline: deadlineSchema.nullable(),
		})
		.strict(),
]);
/** One coherent journal snapshot with durations aged at core publication. */
export const contractsSnapshotSchema = z
	.object({ rows: z.array(contractRowSchema) })
	.strict();
export type ContractsSnapshot = z.infer<typeof contractsSnapshotSchema>;
export type ContractRow = z.infer<typeof contractRowSchema>;
export type ContractLocation = z.infer<typeof contractLocationSchema>;
/** Server-confirmed live membership activity; recovery snapshots contain no activity. */
export const contractMembershipChangeSchema = z
	.object({
		kind: z.enum(["added", "removed"]),
		id,
		name: z.string().nullable(),
	})
	.strict();
export type ContractMembershipChange = z.infer<
	typeof contractMembershipChangeSchema
>;
/** The only journal mutation; acceptance of dispatch does not imply deletion. */
export interface ContractsAction {
	/** Removal leaves quest progress intact. */
	readonly kind: "remove";
	/** Server registry identity; the host validates the u32 boundary. */
	readonly id: number;
}
/** Incremental and recovery transport use the same snapshot shape. */
export const contractsUpdatedSchema = z
	.object({ contracts: contractsSnapshotSchema.nullable() })
	.strict();
