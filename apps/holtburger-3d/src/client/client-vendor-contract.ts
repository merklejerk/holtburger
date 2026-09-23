import { z } from "zod";
import { clientIconAppearanceSchema } from "./client-entity-mirror";

const unsigned = z.number().int().nonnegative().max(0xffff_ffff);
const quantity = z.number().int().positive().max(0x7fff_ffff);

/** Core resolves whole sale quantities; display groups never cross this boundary. */
const vendorDraftSchema = z
	.object({
		vendor: unsigned,
		buys: z.array(z.object({ item: unsigned, amount: quantity }).strict()),
		sells: z.array(unsigned),
	})
	.strict();

/** One identity correlates a preview or execution result with the submitted draft. */
export const vendorRequestSchema = z
	.object({
		sequence: unsigned,
		draft: vendorDraftSchema,
	})
	.strict();

/** Vendor cells use these facts directly without a spatial entity record. */
const vendorOfferSchema = z
	.object({
		guid: unsigned,
		wcid: unsigned,
		name: z.string(),
		item_type: unsigned.nullable(),
		stack_count: unsigned,
		stackable: z.boolean(),
		supply: unsigned.nullable(),
		icon: clientIconAppearanceSchema,
		price: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("quoted"), amount: unsigned, quantity })
				.strict(),
			z.object({ kind: z.literal("unavailable"), reason: z.string() }).strict(),
		]),
	})
	.strict();

/** Complete catalog; same-vendor updates preserve the frontend draft. */
export const vendorSnapshotSchema = z
	.object({
		vendor: unsigned,
		offers: z.array(vendorOfferSchema),
		currency: z.object({ wcid: unsigned, name: z.string() }).strict(),
	})
	.strict()
	.nullable();

const lineQuoteSchema = z
	.object({
		item: unsigned,
		amount: quantity,
		total: unsigned,
		merge_key: unsigned.nullable(),
	})
	.strict();

/** Prices and phase affordability are decided once in world. */
const vendorQuoteSchema = z
	.object({
		buys: z.array(lineQuoteSchema),
		sells: z.array(lineQuoteSchema),
		currencies: z.array(
			z
				.object({
					wcid: unsigned,
					name: z.string(),
					current: unsigned,
					projected: z.number().int().safe(),
				})
				.strict(),
		),
		affordable: z.boolean(),
	})
	.strict();

/** A rejected candidate does not enter the committed queue. */
export const vendorPreviewSchema = z
	.object({
		sequence: unsigned,
		vendor: unsigned,
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("ready"), quote: vendorQuoteSchema }).strict(),
			z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
		]),
	})
	.strict();

/** Current wire phase; no frontend timer advances from selling to buying. */
export const vendorPhaseSchema = z.enum(["selling", "buying"]);

/** Source receipts let a merged cell lose only the stacks which actually sold. */
export const vendorResultSchema = z
	.object({
		sequence: unsigned.nullable(),
		vendor: unsigned,
		sold: z.array(unsigned),
		sale_issue: z.string().nullable(),
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("completed") }).strict(),
			z
				.object({
					kind: z.literal("failed"),
					phase: vendorPhaseSchema,
					message: z.string(),
				})
				.strict(),
		]),
	})
	.strict();

export type VendorDraft = z.infer<typeof vendorDraftSchema>;
export type VendorRequest = z.infer<typeof vendorRequestSchema>;
export type VendorOffer = z.infer<typeof vendorOfferSchema>;
export type VendorSnapshot = z.infer<typeof vendorSnapshotSchema>;
export type VendorQuote = z.infer<typeof vendorQuoteSchema>;
export type VendorPreview = z.infer<typeof vendorPreviewSchema>;
export type VendorPhase = z.infer<typeof vendorPhaseSchema>;
export type VendorResult = z.infer<typeof vendorResultSchema>;
