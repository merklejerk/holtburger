import { entityFacts } from "../../client/client-entity-mirror.test-support";
import {
	tradeRequestSchema,
	type TradeState,
} from "../../client/client-trade-contract";

/** Typed server publications for the production selected-player and trade HUD paths. */
export function createTradeFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	readonly select: (guid: number) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const partner = 5001;
	const item = 6001;
	let trade: TradeState | null = null;
	const publish = (pending_items: readonly number[] = []) =>
		options.emit("client-trade-snapshot", { trade, pending_items });
	return {
		begin() {
			options.baseline();
			trade = null;
			const player = entityFacts(partner, {
				canTrade: true,
				targeting: "creature",
			});
			const source = entityFacts(item, {
				ownedByPlayer: true,
				canOfferTrade: true,
				location: {
					kind: "contained",
					parentGuid: 1,
					slot: { kind: "item", index: 0 },
				},
			});
			options.emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				upserts: [
					player,
					source,
					entityFacts(item + 1, { scenePlacement: "unavailable" }),
				],
				removed: [],
			});
			options.select(partner);
		},
		register() {
			trade = {
				revision: 1,
				partner_guid: partner,
				initiator_guid: 1,
				trade_stamp: 0,
				self_side: { guid: 1, accepted: false, items: [] },
				partner_side: { guid: partner, accepted: false, items: [] },
			};
			publish();
		},
		pending() {
			publish([item]);
		},
		acknowledge() {
			if (trade === null) throw new Error("Trade fixture is not registered");
			trade = {
				...trade,
				revision: trade.revision + 1,
				self_side: { ...trade.self_side, items: [item] },
				partner_side: { ...trade.partner_side, items: [item + 1] },
			};
			publish();
		},
		accepted(side: "self" | "partner", accepted: boolean) {
			if (trade === null) throw new Error("Trade fixture is not registered");
			trade =
				side === "self"
					? { ...trade, self_side: { ...trade.self_side, accepted } }
					: { ...trade, partner_side: { ...trade.partner_side, accepted } };
			publish();
		},
		complete() {
			if (trade === null) throw new Error("Trade fixture is not registered");
			trade = {
				...trade,
				revision: trade.revision + 1,
				self_side: { ...trade.self_side, accepted: false, items: [] },
				partner_side: { ...trade.partner_side, accepted: false, items: [] },
			};
			publish();
		},
		close() {
			trade = null;
			publish();
		},
		request() {
			const args = options.commands.findLast(
				(entry) => entry.command === "submit_client_trade",
			)?.args;
			if (args === undefined)
				throw new Error("Trade fixture has no submitted request");
			return tradeRequestSchema.parse(args.request);
		},
	};
}
