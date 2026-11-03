import {
	progressionTarget,
	type CharacterSheet,
	type ProgressionQuote,
	type StatTarget,
} from "./client-character-sheet-contract";

/** A confirmed local purchase, independent of DOM identity and animation choices. */
export interface ProgressionGain {
	/** Earliest display revision that includes these authoritative facts. */
	readonly revision: number;
	/** Purchased stat, including a skill that may move between training sections. */
	readonly target: StatTarget;
	/** Training is a distinct celebration rather than a numeric rank gain. */
	readonly reward:
		| { readonly kind: "ranks"; readonly amount: number }
		| { readonly kind: "trained" };
	/** Trained skills whose rounded base formula contribution and displayed base increased. */
	readonly synergies: readonly StatTarget[];
}

/** Purchased ranks and training, rather than effective values, establish success. */
export function confirmedProgressionGain(
	before: CharacterSheet,
	after: CharacterSheet,
	quote: ProgressionQuote,
	revision: number,
): ProgressionGain | null {
	if (
		before.character !== after.character ||
		quote.quote.character !== after.character
	)
		return null;
	const target = progressionTarget(quote.quote.intent);
	const stat =
		"Attribute" in target
			? after.attributes.find((row) => row.attr_type === target.Attribute)
			: "Vital" in target
				? after.vitals.find((row) => row.vital_type === target.Vital)
				: after.skills.find((row) => row.stat.skill_type === target.Skill)
						?.stat;
	if (stat === undefined) return null;
	const training = "Train" in quote.quote.intent;
	const amount = stat.ranks - quote.quote.target_state.ranks;
	if (
		training
			? !(
					"training" in stat &&
					quote.quote.target_state.training === "Untrained" &&
					(stat.training === "Trained" || stat.training === "Specialized")
				)
			: amount <= 0
	)
		return null;
	const synergies: StatTarget[] = [];
	if ("Attribute" in target) {
		for (const row of after.skills) {
			const skill = row.stat;
			if (
				!row.availableInEor ||
				(skill.training !== "Trained" && skill.training !== "Specialized")
			)
				continue;
			const old = before.skills.find(
				(row) => row.stat.skill_type === skill.skill_type,
			)?.stat;
			const formula = skill.breakdown.formula;
			const oldFormula = old?.breakdown.formula;
			if (
				old === undefined ||
				old.training !== skill.training ||
				old.ranks !== skill.ranks ||
				typeof formula === "string" ||
				oldFormula === undefined ||
				typeof oldFormula === "string"
			)
				continue;
			const inputs = [formula.Applied.first, formula.Applied.second];
			const oldInputs = [oldFormula.Applied.first, oldFormula.Applied.second];
			// Base inputs exclude buffs; unchanged rank/training excludes a concurrent skill purchase.
			if (
				inputs.some((input, index) => {
					const previous = oldInputs[index];
					return (
						input !== null &&
						previous !== null &&
						previous !== undefined &&
						input.attribute === target.Attribute &&
						previous.attribute === input.attribute &&
						input.base > previous.base
					);
				}) &&
				formula.Applied.base_result > oldFormula.Applied.base_result &&
				skill.base > old.base
			)
				synergies.push({ Skill: skill.skill_type });
		}
	}
	return {
		revision,
		target,
		reward: training ? { kind: "trained" } : { kind: "ranks", amount },
		synergies,
	};
}
