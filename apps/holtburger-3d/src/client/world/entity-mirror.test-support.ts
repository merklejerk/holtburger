import type {
	ClientEntityDelta,
	ClientEntityFacts,
	ClientEntitySnapshot,
	PlayerEntitySummary,
} from "./entity-mirror";

type KnownEntityDescription = Extract<
	ClientEntityFacts["description"],
	{ kind: "known" }
>;

export const emptyPlayerSummary: PlayerEntitySummary = {
	pyrealBalance: null,
	burden: null,
	aetheriaActivation: null,
};

/** Minimal delta wrapper so tests specify only the semantic fields under test. */
export function entityDelta(
	overrides: Partial<ClientEntityDelta> = {},
): ClientEntityDelta {
	return {
		projectileSupply: null,
		player: null,
		worldContainer: null,
		upserts: [],
		removed: [],
		...overrides,
	};
}

/** Known creature fixture with health-query eligibility enabled by default. */
export function creatureFacts(
	guid: number,
	overrides: Partial<ClientEntityFacts> = {},
	descriptionOverrides: Partial<KnownEntityDescription> = {},
): ClientEntityFacts {
	const base = entityFacts(guid, { targeting: "creature", ...overrides });
	if (base.description.kind !== "known") return base;
	return {
		...base,
		description: {
			...base.description,
			name: `Creature ${guid}`,
			healthQuery: "eligible",
			...descriptionOverrides,
		},
	};
}

/** Minimal established player root for transport fixtures unrelated to inventory. */
export function playerEntitySnapshot(playerGuid: number): ClientEntitySnapshot {
	return {
		projectileSupply: { kind: "not-applicable" },
		player: emptyPlayerSummary,
		worldContainer: { kind: "closed" },
		entities: [entityFacts(playerGuid)],
	};
}

/** Known non-creature fixture; each scenario explicitly supplies its storage relationship. */
export function entityFacts(
	guid: number,
	overrides?: Omit<Partial<ClientEntityFacts>, "description">,
): ClientEntityFacts & { readonly description: KnownEntityDescription };
export function entityFacts(
	guid: number,
	overrides: Partial<ClientEntityFacts>,
): ClientEntityFacts;
export function entityFacts(
	guid: number,
	overrides: Partial<ClientEntityFacts> = {},
): ClientEntityFacts {
	return {
		guid,
		nearby: null,
		summon: null,
		canPickUp: false,
		worldContainerContent: false,
		canReceiveGive: false,
		canTrade: false,
		isHostile: false,
		canOfferTrade: false,
		vendorSale: null,
		lockTool: null,
		isLocked: null,
		salvage: { kind: "ineligible", reason: "Fixture item cannot be salvaged." },
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
			equipLocations: null,
			consumable: null,
			useCapability: "direct" as const,
			stackCount: null,
			cooldown: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
			equipmentCantrip: null,
		},
		location: { kind: "none" },
		ownedByPlayer: false,
		targeting: "non-creature",
		scenePlacement: "available",
		storage: { kind: "not-established" },
		...overrides,
		corpse: overrides.corpse ?? null,
		health: overrides.health ?? null,
	};
}
