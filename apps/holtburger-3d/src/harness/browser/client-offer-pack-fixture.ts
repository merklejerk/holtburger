import { entityFacts } from "../../client/client-entity-mirror.test-support";

/** Two real pack-strip drag sources with mixed direct contents for both transaction probes. */
export function offerPackFixture(vendor: number) {
	return [
		...[8000, 8001].map((guid, index) =>
			entityFacts(guid, {
				ownedByPlayer: true,
				canOfferTrade: index === 1,
				vendorSale: { vendor, accepted: index === 1 },
				location: {
					kind: "contained",
					parentGuid: 1,
					slot: { kind: "pack", index: index + 5, entryKind: "container" },
				},
				storage: {
					kind: "container",
					roster: "announced",
					itemCapacity: 24,
					packCapacity: 0,
				},
			}),
		),
		...[8010, 8011, 8012].map((guid, index) =>
			entityFacts(guid, {
				ownedByPlayer: true,
				canOfferTrade: index !== 2,
				vendorSale: { vendor, accepted: index !== 2 },
				location: {
					kind: "contained",
					parentGuid: 8000,
					slot: { kind: "item", index },
				},
			}),
		),
	];
}
