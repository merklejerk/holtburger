import { z } from "zod";

const unsigned = z.number().int().min(0).max(0xffff_ffff);

/** Identity-based destinations mirror the shared core intent, never browser array indices. */
const inventoryTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("split"), amount: unsigned.positive() }),
	z.object({ kind: z.literal("item"), guid: unsigned }),
	z.object({ kind: z.literal("stack"), guid: unsigned }),
	z.object({ kind: z.literal("container"), guid: unsigned }),
	z.object({ kind: z.literal("equipment"), mask: unsigned }),
	z.object({ kind: z.literal("pack"), guid: unsigned }),
]);

/** One inventory gesture submitted to the shared evaluator. */
export const inventoryIntentSchema = z.object({
	item: unsigned,
	target: inventoryTargetSchema,
});

/** Correlates asynchronous previews with the current gesture target. */
export const inventoryPreviewRequestSchema = z.object({
	sequence: unsigned,
	intent: inventoryIntentSchema,
});

/** Shared semantic consequence; presentation only adds its local sort-mode restriction. */
export const inventoryPreviewResultSchema = z.object({
	sequence: unsigned,
	preview: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("split"), max_amount: unsigned.positive() }),
		z.object({ kind: z.literal("noop") }),
		z.object({ kind: z.literal("merge"), amount: unsigned.positive() }),
		z.object({ kind: z.literal("move") }),
		z.object({ kind: z.literal("equip"), displaced: z.array(unsigned) }),
		z.object({ kind: z.literal("swap") }),
		z.object({ kind: z.literal("rejected"), reason: z.string() }),
	]),
});

/** Validated preview request at the app-local boundary. */
export type ClientInventoryPreviewRequest = z.infer<
	typeof inventoryPreviewRequestSchema
>;
/** Validated consequence returned by core. */
export type ClientInventoryPreviewResult = z.infer<
	typeof inventoryPreviewResultSchema
>;

/** One item and its semantic destination. */
export type ClientInventoryIntent = z.infer<typeof inventoryIntentSchema>;

// All panel interaction owners share an identity space across mounts and dialog lifetimes.
let previewSequence = 0;
/** Allocate a unique correlation identity for inventory previews. */
export function nextInventoryPreviewSequence(): number {
	if (previewSequence === 0xffff_ffff)
		throw new Error("Inventory preview sequence exhausted");
	return ++previewSequence;
}
