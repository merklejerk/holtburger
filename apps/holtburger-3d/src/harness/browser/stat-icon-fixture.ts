import type { StatIconReferences } from "../../client/client-stat-artwork";
/** Deterministic artwork identities for asset-independent production UI probes. */
export const STAT_ICON_FIXTURE: StatIconReferences = [
	...[
		"StrengthAttr",
		"EnduranceAttr",
		"CoordinationAttr",
		"QuicknessAttr",
		"FocusAttr",
		"SelfAttr",
	].map((attribute, creationId) => ({
		target: { Attribute: attribute },
		creationId,
		artwork: {
			kind: "ready" as const,
			spec: { kind: "base" as const, base: 0x06000001 + creationId },
		},
	})),
	...["Health", "Stamina", "Mana"].map((vital, creationId) => ({
		target: { Vital: vital },
		creationId,
		artwork: {
			kind: "ready" as const,
			spec: { kind: "base" as const, base: 0x06000011 + creationId },
		},
	})),
	...[
		{ id: 6, skill: "MeleeDefense" },
		{ id: 44, skill: "HeavyWeapons" },
		{ id: 40, skill: "Salvaging" },
	].map(({ id, skill }) => ({
		target: { Skill: skill },
		creationId: id,
		artwork: {
			kind: "ready" as const,
			spec: { kind: "base" as const, base: 0x06000100 + id },
		},
	})),
];
