import { z } from "zod";

const unsigned = z.number().int().nonnegative().max(0xffff_ffff);
const side = z
	.object({ guid: unsigned, accepted: z.boolean(), items: z.array(unsigned) })
	.strict();

/** World-owned offers and revision; presentation never counts item changes to infer freshness. */
const tradeStateSchema = z
	.object({
		revision: unsigned,
		partner_guid: unsigned,
		initiator_guid: unsigned,
		trade_stamp: z.number().finite(),
		self_side: side,
		partner_side: side,
	})
	.strict();

/** Shared acknowledgment waits travel with confirmed offers at both publication boundaries. */
export const tradeSnapshotSchema = z
	.object({
		trade: tradeStateSchema.nullable(),
		pending_items: z.array(unsigned),
	})
	.strict();

/** Same guarded command contract used by the TUI and H3D. */
export const tradeRequestSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("open"), partner: unsigned }).strict(),
	z
		.object({
			kind: z.literal("add"),
			partner: unsigned,
			revision: unsigned,
			item: unsigned,
		})
		.strict(),
	z
		.object({
			kind: z.literal("accept"),
			partner: unsigned,
			revision: unsigned,
		})
		.strict(),
	z.object({ kind: z.literal("withdraw"), partner: unsigned }).strict(),
	z.object({ kind: z.literal("reset"), partner: unsigned }).strict(),
	z.object({ kind: z.literal("close"), partner: unsigned }).strict(),
]);

export type TradeState = z.infer<typeof tradeStateSchema>;
export type TradeSnapshot = z.infer<typeof tradeSnapshotSchema>;
export type TradeRequest = z.infer<typeof tradeRequestSchema>;
