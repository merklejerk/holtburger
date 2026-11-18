import { entityFacts } from "../../client/client-entity-mirror.test-support";
import type { TradeState } from "../../client/client-trade-contract";

/** Synthetic trade session publications for the interactive UI showcase. */
export function createTradeFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	readonly select: (guid: number) => void;
}) {
	const partner = 5001;
	const item = 6001;
	let trade: TradeState | null = null;
	const publish = () =>
		options.emit("client-trade-snapshot", { trade, pending_items: [] });
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
				salvage: {
					kind: "ineligible",
					reason: "Fixture item cannot be salvaged.",
				},
				location: {
					kind: "contained",
					parentGuid: 1,
					slot: { kind: "item", index: 0 },
				},
			});
			options.emit("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [
					player,
					source,
					entityFacts(item + 2, {
						ownedByPlayer: true,
						canOfferTrade: false,
						location: {
							kind: "contained",
							parentGuid: 1,
							slot: { kind: "item", index: 1 },
						},
					}),
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
	};
}
