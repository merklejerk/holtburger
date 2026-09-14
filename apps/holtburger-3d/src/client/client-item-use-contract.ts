import { z } from "zod";

const identity = z.number().int().min(0).max(0xffff_ffff);

/** Explicit identities and direct-use diagnostic policy, independent of mutable selection. */
const intentSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("direct"),
			source: identity,
			unrestricted: z.boolean(),
		})
		.strict(),
	z
		.object({ kind: z.literal("targeted"), source: identity, target: identity })
		.strict(),
]);
/** Expected semantic consequence; core does not interpret it as user approval. */
const itemUseConsequenceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ordinary") }).strict(),
	z
		.object({
			kind: z.literal("destroy-item"),
			target: identity,
			amount: identity.positive(),
		})
		.strict(),
]);
/** World-produced consequence plus presentation facts, without a confirmation instruction. */
const evaluationSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ordinary") }).strict(),
	z
		.object({
			kind: z.literal("destroy-item"),
			target: identity,
			amount: identity.positive(),
			name: z.string(),
		})
		.strict(),
]);
/** Correlated request bound to the originating character. */
export const itemUseRequestSchema = z
	.object({
		sequence: identity,
		player: identity,
		sourceOwned: z.boolean(),
		intent: intentSchema,
		expected: itemUseConsequenceSchema,
	})
	.strict();
/** Evaluation mismatch never dispatches the game action. Executed still awaits server success. */
export const itemUseResultSchema = z
	.object({
		sequence: identity,
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
			z
				.object({
					kind: z.literal("consequence-changed"),
					evaluation: evaluationSchema,
				})
				.strict(),
			z.object({ kind: z.literal("executed") }).strict(),
		]),
	})
	.strict();

/** Typed frontend submission to guarded core execution. */
export type ClientItemUseRequest = z.infer<typeof itemUseRequestSchema>;
/** Correlated core result delivered through the lifecycle session. */
export type ClientItemUseResult = z.infer<typeof itemUseResultSchema>;

/** Read-only query for one hovered combine pairing. */
export const itemUseTargetQuerySchema = z
	.object({ sequence: identity, source: identity, target: identity })
	.strict();
/** Public-fact eligibility, independent of busy state or confirmation policy. */
export const itemUseTargetResultSchema = z
	.object({ sequence: identity, eligible: z.boolean() })
	.strict();
export type ClientItemUseTargetQuery = z.infer<typeof itemUseTargetQuerySchema>;
export type ClientItemUseTargetResult = z.infer<
	typeof itemUseTargetResultSchema
>;
