import {
	CANTRIP_TIERS,
	type CantripTier,
	type SpellReference,
} from "../app/spell-references";

interface ItemSpell {
	readonly id: number;
	readonly activeEnchantment: boolean;
}

interface ItemCantripPill {
	readonly tier: CantripTier;
	readonly label: string;
	readonly abbreviatedLabel: string;
	readonly count: number;
}

const TIER_LABELS: Record<
	CantripTier,
	{ readonly full: string; readonly abbreviated: string }
> = {
	feeble: { full: "Feeble", abbreviated: "Feeb." },
	minor: { full: "Minor", abbreviated: "Min." },
	moderate: { full: "Moderate", abbreviated: "Mod." },
	major: { full: "Major", abbreviated: "Maj." },
	epic: { full: "Epic", abbreviated: "Epic" },
	legendary: { full: "Legendary", abbreviated: "Leg." },
	other: { full: "Other", abbreviated: "Other" },
};

export type ItemCantripSummary =
	| { readonly kind: "hidden" }
	| { readonly kind: "loading" }
	| {
			readonly kind: "ready";
			readonly pills: readonly ItemCantripPill[];
			readonly incompleteCount: number;
	  };

/** Summarize unique intrinsic spell identities without counting active enchantments. */
export function summarizeItemCantrips(
	spells: readonly ItemSpell[],
	references: readonly SpellReference[] | null,
	lookupFailed: boolean,
): ItemCantripSummary {
	const intrinsicIds = [
		...new Set(
			spells
				.filter(({ activeEnchantment }) => !activeEnchantment)
				.map(({ id }) => id),
		),
	];
	if (intrinsicIds.length === 0) return { kind: "hidden" };
	if (references === null && !lookupFailed) return { kind: "loading" };

	const referencesById = new Map(
		(references ?? []).map((reference) => [reference.id, reference]),
	);
	const counts = new Map<CantripTier, number>();
	let incompleteCount = 0;
	for (const id of intrinsicIds) {
		const reference = referencesById.get(id);
		if (reference === undefined || reference.kind !== "known") {
			incompleteCount += 1;
			continue;
		}
		const tier = reference.details.cantripTier;
		if (tier !== null) counts.set(tier, (counts.get(tier) ?? 0) + 1);
	}
	return {
		kind: "ready",
		pills: CANTRIP_TIERS.flatMap((tier) => {
			const count = counts.get(tier);
			const labels = TIER_LABELS[tier];
			return count === undefined
				? []
				: [
						{
							tier,
							label: labels.full,
							abbreviatedLabel: labels.abbreviated,
							count,
						},
					];
		}),
		incompleteCount,
	};
}
