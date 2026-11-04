import { describe, expect, it } from "vitest";
import { attributeSkillSynergies } from "./client-attribute-synergies";
import type { CharacterSheet } from "./client-character-sheet-contract";

type Input = Parameters<typeof attributeSkillSynergies>[0][number];
function skill(
	skill_type: string,
	training: CharacterSheet["skills"][number]["stat"]["training"],
	attributes: readonly [string, string | null],
	divisor: number,
): Input {
	const input = (attribute: string) => ({
		attribute,
		base: 100,
		effective: 110,
		modifiers: [],
	});
	return {
		skill_type,
		training,
		breakdown: {
			formula: {
				Applied: {
					first: input(attributes[0]),
					second: attributes[1] === null ? null : input(attributes[1]),
					divisor,
					base_before_rounding: 0,
					effective_before_rounding: 0,
					base_result: 0,
					effective_result: 0,
				},
			},
		},
	};
}

describe("attribute skill synergies", () => {
	it("reverses applied trained and specialized formulas without including untrained skills", () => {
		const skills = [
			skill(
				"MeleeDefense",
				"Trained",
				["QuicknessAttr", "CoordinationAttr"],
				3,
			),
			skill("Run", "Specialized", ["QuicknessAttr", null], 1),
			skill("Jump", "Untrained", ["CoordinationAttr", null], 2),
			skill("ArcaneLore", "Unusable", ["FocusAttr", null], 3),
			{
				skill_type: "Salvaging",
				training: "Trained",
				breakdown: { formula: "NoFormula" },
			} as const,
		];
		expect([...attributeSkillSynergies(skills)]).toEqual([
			[
				"QuicknessAttr",
				[
					{ skill: "MeleeDefense", multiplier: 1 / 3 },
					{ skill: "Run", multiplier: 1 },
				],
			],
			["CoordinationAttr", [{ skill: "MeleeDefense", multiplier: 1 / 3 }]],
		]);
	});
	it("combines repeated attribute inputs into one skill contribution", () => {
		expect(
			attributeSkillSynergies([
				skill("Example", "Trained", ["FocusAttr", "FocusAttr"], 4),
			]).get("FocusAttr"),
		).toEqual([{ skill: "Example", multiplier: 0.5 }]);
	});
});
