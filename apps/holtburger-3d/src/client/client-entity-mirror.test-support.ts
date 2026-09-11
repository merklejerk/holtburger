import type {
	ClientEntityFacts,
	ClientEntitySnapshot,
} from "./client-entity-mirror";

/** Minimal established player root for transport fixtures unrelated to inventory. */
export function playerEntitySnapshot(playerGuid: number): ClientEntitySnapshot {
	return { entities: [entityFacts(playerGuid)] };
}

/** Known non-creature fixture; each scenario explicitly supplies its storage relationship. */
export function entityFacts(
	guid: number,
	overrides: Partial<ClientEntityFacts> = {},
): ClientEntityFacts {
	return {
		guid,
		description: {
			kind: "known",
			name: `Item ${guid}`,
			healthQuery: "ineligible",
			itemType: 0,
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
		},
		location: { kind: "none" },
		ownedByPlayer: false,
		scenePlacement: "available",
		storage: { kind: "not-established" },
		...overrides,
	};
}
