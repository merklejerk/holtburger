import type { CharacterSheet } from "./client-character-sheet-contract";

type Skill = CharacterSheet["skills"][number]["stat"];
/** Formula facts are already evaluated by the world; this helper only reverses their presentation. */
type SynergyInput = Pick<Skill, "skill_type" | "training"> & {
	readonly breakdown: Pick<Skill["breakdown"], "formula">;
};
/** One trained skill's unrounded contribution from a point in the owning attribute. */
export interface AttributeSkillSynergy {
	/** Canonical skill identity, formatted with the character sheet's existing name formatter. */
	readonly skill: string;
	/** Formula coefficient before stat rounding, enchantments and vitae. */
	readonly multiplier: number;
}

/** Reverse the authoritative formulas once per display snapshot, excluding untrained skills. */
export function attributeSkillSynergies(
	skills: readonly SynergyInput[],
): ReadonlyMap<string, readonly AttributeSkillSynergy[]> {
	const attributes = new Map<string, AttributeSkillSynergy[]>();
	for (const stat of skills) {
		if (stat.training !== "Trained" && stat.training !== "Specialized")
			continue;
		const formula = stat.breakdown.formula;
		if (typeof formula === "string") continue;
		const { first, second, divisor } = formula.Applied;
		const weights = new Map<string, number>();
		for (const input of second === null ? [first] : [first, second])
			weights.set(
				input.attribute,
				(weights.get(input.attribute) ?? 0) + 1 / divisor,
			);
		for (const [attribute, multiplier] of weights) {
			const rows = attributes.get(attribute) ?? [];
			rows.push({ skill: stat.skill_type, multiplier });
			attributes.set(attribute, rows);
		}
	}
	return attributes;
}
