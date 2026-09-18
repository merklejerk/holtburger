import { z } from "zod";
import { entityAppearanceSchema } from "../lib/game/runtime/entity-appearance-contract";

const nonNegativeInteger = z.number().int().nonnegative();
const dataId = nonNegativeInteger.max(0xffff_ffff);

const objectPreviewClipSchema = z
	.object({
		animationId: dataId,
		lowFrame: nonNegativeInteger,
		highFrame: nonNegativeInteger,
		framerate: z.number().finite(),
	})
	.strict();

const objectPreviewPoseSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("default-idle"),
			clips: z.array(objectPreviewClipSchema).min(1),
			firstCyclicClip: nonNegativeInteger,
		})
		.strict()
		.refine((pose) => pose.firstCyclicClip < pose.clips.length, {
			message: "The cyclic clip index must name an authored clip.",
			path: ["firstCyclicClip"],
		}),
	z.object({ kind: z.literal("setup-pose") }).strict(),
]);

const objectPreviewSourceSchema = z
	.object({
		guid: dataId,
		setupDid: dataId,
		appearance: entityAppearanceSchema,
		scale: z.number().finite().positive(),
		translucency: z.number().finite().min(0).max(1),
		pose: objectPreviewPoseSchema,
	})
	.strict();

const objectPreviewResultSchema = z
	.object({
		guid: dataId,
		outcome: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("ready"), source: objectPreviewSourceSchema })
				.strict(),
			z.object({ kind: z.literal("unavailable") }).strict(),
		]),
	})
	.strict();

type DeepReadonly<T> = T extends readonly (infer Item)[]
	? readonly DeepReadonly<Item>[]
	: T extends object
		? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
		: T;

/** Captured creature visual identity and idle-pose policy. */
export type ObjectPreviewResult = DeepReadonly<
	z.infer<typeof objectPreviewResultSchema>
>;
export type ObjectPreviewSource = Extract<
	ObjectPreviewResult["outcome"],
	{ readonly kind: "ready" }
>["source"];

/** Strictly decode one host preview event before it enters UI or renderer state. */
export function decodeObjectPreviewResult(
	payload: unknown,
): ObjectPreviewResult {
	return objectPreviewResultSchema.strict().parse(payload);
}
