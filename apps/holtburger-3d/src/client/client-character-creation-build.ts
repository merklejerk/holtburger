import {
	CREATION_ATTRIBUTES,
	type CharacterCreationCatalog,
	type CharacterCreationDraft,
} from "./client-character-creation-contract";
import {
	creationBuildBalance,
	type CreationHeritage,
} from "./client-character-creation";

/** One adjacent training change, including its already-resolved budget decision. */
export type CreationSkillAction =
	| {
			readonly kind: "available";
			/** Verb exposed by the button's accessible label and tooltip. */
			readonly label: string;
			/** Signed charge; a negative charge refunds credits. */
			readonly credits: number;
			/** Destination advancement written by the action consumer. */
			readonly advancement: 1 | 2 | 3;
	  }
	| {
			readonly kind: "blocked";
			/** Verb retained on the disabled control. */
			readonly label: string;
			/** Specific rule preventing this adjacent change. */
			readonly reason: string;
			/** Tier charge shown even when blocked by affordability; null means no tier exists. */
			readonly credits: number | null;
	  };

/** Attribute slider bounds include the credits that can be spent on this attribute now. */
export interface CreationAttributeControl {
	/** Protocol tuple index used by the edit consumer. */
	readonly index: number;
	/** Display label shared with the formula contract. */
	readonly label: string;
	/** Current integer attribute value. */
	readonly value: number;
	/** Catalog lower bound. */
	readonly minimum: number;
	/** Catalog upper bound restricted by the remaining attribute budget. */
	readonly maximum: number;
}

type Skill = CreationHeritage["skills"][number];

function skillActions(skill: Skill, training: number, remaining: number) {
	const upgradeLabel = training < 2 ? "Train" : "Specialize";
	const upgradeCost =
		training < 2 ? skill.trainedCost : skill.specializationUpgradeCost;
	let upgrade: CreationSkillAction;
	if (training === 3)
		upgrade = {
			kind: "blocked",
			credits: null,
			label: "Specialize",
			reason: "Already specialized.",
		};
	else if (upgradeCost === null)
		upgrade = {
			kind: "blocked",
			credits: null,
			label: upgradeLabel,
			reason: `${upgradeLabel} is unavailable at character creation.`,
		};
	else if (upgradeCost > remaining)
		upgrade = {
			kind: "blocked",
			credits: upgradeCost,
			label: upgradeLabel,
			reason: `Requires ${upgradeCost} skill credits; ${remaining} remaining.`,
		};
	else
		upgrade = {
			kind: "available",
			label: upgradeLabel,
			credits: upgradeCost,
			advancement: training < 2 ? 2 : 3,
		};

	const downgradeLabel = training === 3 ? "Unspecialize" : "Untrain";
	const lower = training === 3 ? 2 : 1;
	let downgrade: CreationSkillAction;
	if (training < 2)
		downgrade = {
			kind: "blocked",
			credits: null,
			label: downgradeLabel,
			reason: "Already untrained.",
		};
	else if (lower < skill.minimumAdvancement)
		downgrade = {
			kind: "blocked",
			credits: null,
			label: downgradeLabel,
			reason: "Required starting training cannot be removed.",
		};
	else {
		const refund =
			training === 3 ? skill.specializationUpgradeCost : skill.trainedCost;
		if (refund === null)
			throw new Error(`Cannot refund an unavailable tier for ${skill.name}.`);
		downgrade = {
			kind: "available",
			label: downgradeLabel,
			credits: -refund,
			advancement: lower,
		};
	}
	return { upgrade, downgrade };
}

/** Own all cold editor bounds and availability decisions; markup and edit handlers consume them. */
export function creationBuildControls(
	catalog: CharacterCreationCatalog,
	heritage: CreationHeritage,
	draft: CharacterCreationDraft,
) {
	const balance = creationBuildBalance(heritage, draft);
	if (balance.attributes < 0)
		throw new Error("Creation draft exceeds its attribute budget.");
	if (balance.skills < 0)
		throw new Error("Creation draft exceeds its skill budget.");
	const attributes: CreationAttributeControl[] = draft.attributes.map(
		(value, index) => ({
			index,
			label: CREATION_ATTRIBUTES[index],
			value,
			minimum: catalog.minimumAttribute,
			maximum: Math.min(catalog.maximumAttribute, value + balance.attributes),
		}),
	);
	const skills = heritage.skills
		.map((skill) => {
			const current = draft.skills[skill.id];
			if (
				current === undefined ||
				!Number.isInteger(current) ||
				current < 0 ||
				current > 3
			)
				throw new Error(`Invalid creation advancement for ${skill.name}.`);
			const training = current === 0 ? 1 : current;
			return {
				skill,
				training,
				...skillActions(skill, training, balance.skills),
			};
		})
		.toSorted((a, b) => a.skill.name.localeCompare(b.skill.name));
	return { balance, attributes, skills };
}

/** Clamp drag/keyboard edits to the current slider contract, matching TUI budget-limited maximization. */
export function applyCreationAttribute(
	draft: CharacterCreationDraft,
	control: CreationAttributeControl,
	value: number,
): CharacterCreationDraft {
	if (!Number.isInteger(value))
		throw new Error("Creation attributes must be integers.");
	const attributes: CharacterCreationDraft["attributes"] = [
		...draft.attributes,
	];
	attributes[control.index] = Math.max(
		control.minimum,
		Math.min(control.maximum, value),
	);
	return { ...draft, attributes };
}

/** A blocked click cannot spend credits; enabled actions carry the tier decision from the projection. */
export function applyCreationSkill(
	draft: CharacterCreationDraft,
	skillId: number,
	action: CreationSkillAction,
): CharacterCreationDraft {
	if (action.kind === "blocked") return draft;
	const skills = [...draft.skills];
	skills[skillId] = action.advancement;
	return { ...draft, skills };
}

/** Show the attribute expression without runtime rounding details; formula-free skills stay unlabeled. */
export function creationSkillFormulaText(
	formula: Skill["formula"],
): string | null {
	if (formula === null) return null;
	const sum =
		formula.second === null
			? formula.first
			: `(${formula.first} + ${formula.second})`;
	return formula.divisor === 1 ? sum : `${sum} / ${formula.divisor}`;
}
