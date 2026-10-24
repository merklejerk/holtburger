import { z } from "zod";
import {
	parentLocationSchema,
	placementSchema,
	placementKey,
} from "../lib/game/runtime/attachment-contract.js";
import type { ObjectPreviewSource as RenderObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import { entityAppearanceSchema } from "../lib/game/runtime/entity-appearance-contract.js";

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

export const objectPreviewVisualSchema = z
	.object({
		setupDid: dataId,
		appearance: entityAppearanceSchema,
		scale: z.number().finite().positive(),
		translucency: z.number().finite().min(0).max(1),
		pose: objectPreviewPoseSchema,
	})
	.strict();

/** Lossless accepted composition, excluding frontend backdrop/camera policy. */
const objectPreviewSourceSchema = z
	.object({
		body: objectPreviewVisualSchema,
		attachments: z.array(
			z
				.object({
					visual: objectPreviewVisualSchema,
					parentLocation: parentLocationSchema,
					placement: placementSchema,
				})
				.strict(),
		),
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
			z.object({ kind: z.literal("pending-equipment") }).strict(),
		]),
	})
	.strict();

/** Character identity and complete visual travel atomically through recovery and persistence. */
export const playerVisualCaptureSchema = z
	.object({ guid: dataId, source: objectPreviewSourceSchema })
	.strict();

/** Complete accepted capture independent of later world retention. */
export type PlayerVisualCapture = DeepReadonly<
	z.infer<typeof playerVisualCaptureSchema>
>;

/** Captured wire values stay immutable through cache and renderer handoffs. */
export type DeepReadonly<T> = T extends readonly (infer Item)[]
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

/** Interpret named child placements once at the frontend's renderer boundary. */
export function objectPreviewSourceForRendering(
	source: ObjectPreviewSource,
): RenderObjectPreviewSource {
	return {
		body: source.body,
		attachments: source.attachments.map((attachment) => ({
			...attachment,
			placement: placementKey(attachment.placement),
		})),
		background: null,
	};
}
