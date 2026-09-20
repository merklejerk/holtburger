import type {
	ClientEntityFacts,
	ClientEntitySnapshot,
} from "./client-entity-mirror";

/** Minimal established player root for transport fixtures unrelated to inventory. */
export function playerEntitySnapshot(playerGuid: number): ClientEntitySnapshot {
	return {
		worldContainer: { kind: "closed" },
		entities: [entityFacts(playerGuid)],
	};
}

/** Known non-creature fixture; each scenario explicitly supplies its storage relationship. */
export function entityFacts(
	guid: number,
	overrides: Partial<ClientEntityFacts> = {},
): ClientEntityFacts {
	return {
		guid,
		canPickUp: false,
		worldContainerContent: false,
		canReceiveGive: false,
		description: {
			kind: "known",
			name: `Item ${guid}`,
			healthQuery: "ineligible",
			itemType: 0,
			hasAlternateEquipSide: false,
			builtInSpell: null,
			mapCategory: "other",
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			consumable: null,
			useCapability: "direct" as const,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
		location: { kind: "none" },
		ownedByPlayer: false,
		targeting: "non-creature",
		scenePlacement: "available",
		storage: { kind: "not-established" },
		...overrides,
		corpse: overrides.corpse ?? null,
	};
}
