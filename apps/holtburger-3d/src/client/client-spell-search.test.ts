import { describe, expect, it } from "vitest";
import {
	matchesSpellSearch as matchesGroupedSpellSearch,
	spellFilterGroups,
	type SpellFilterTag,
	type SpellSearchEntry,
	spellSearchEntry,
	spellSearchWords,
} from "./client-spell-search";
import type { SpellDetails } from "../app/spell-references";

function matchesSpellSearch(
	entry: SpellSearchEntry,
	terms: readonly string[],
	tags: readonly SpellFilterTag[],
) {
	return matchesGroupedSpellSearch(entry, terms, spellFilterGroups(tags));
}

const details: SpellDetails = {
	description: "",
	school: 2,
	baseMana: 10,
	manaPerTarget: 0,
	durationSeconds: null,
	classification: {
		beneficial: true,
		level: 7,
		target: "self-target",
		fellowship: true,
		damage: "acid",
	},
};

describe("spell discovery matching", () => {
	it("combines Direct with damage alternatives and other categories", () => {
		const entry = spellSearchEntry("Harm Other I", {
			...details,
			classification: {
				...details.classification,
				damage: "direct",
				beneficial: false,
				target: "other",
			},
		});
		expect(
			matchesSpellSearch(entry, spellSearchWords("harm"), [
				"direct",
				"acid",
				"harmful",
			]),
		).toBe(true);
		expect(matchesSpellSearch(entry, [], ["direct", "beneficial"])).toBe(false);
	});
	it("distinguishes caster debuffs from beneficial self spells", () => {
		const buff = spellSearchEntry("Strength Self I", details);
		const debuff = spellSearchEntry("Weakness Self I", {
			...details,
			classification: { ...details.classification, beneficial: false },
		});
		expect(matchesSpellSearch(buff, [], ["beneficial"])).toBe(true);
		expect(matchesSpellSearch(debuff, [], ["beneficial"])).toBe(false);
		expect(matchesSpellSearch(debuff, [], ["harmful"])).toBe(true);
		expect(matchesSpellSearch(buff, [], ["beneficial", "harmful"])).toBe(true);
	});
	it("unions within categories and intersects categories and every search term", () => {
		const entry = spellSearchEntry("Acid Protection VII", details);
		expect(matchesSpellSearch(entry, [], ["acid", "frost", "school:2"])).toBe(
			true,
		);
		expect(matchesSpellSearch(entry, [], ["acid", "frost", "school:1"])).toBe(
			false,
		);
		expect(
			matchesSpellSearch(entry, [], ["level:6", "level:7", "beneficial"]),
		).toBe(true);
		expect(matchesSpellSearch(entry, [], ["fire", "school:1"])).toBe(false);
		expect(
			matchesSpellSearch(entry, spellSearchWords("frost"), [
				"acid",
				"school:2",
			]),
		).toBe(false);
		expect(matchesSpellSearch(entry, [], ["self-target", "harmful"])).toBe(
			false,
		);
		expect(
			matchesSpellSearch(entry, spellSearchWords("PROT acid"), [
				"school:2",
				"level:7",
				"acid",
			]),
		).toBe(true);
		expect(matchesSpellSearch(entry, spellSearchWords("acid zz"), [])).toBe(
			false,
		);
		expect(matchesSpellSearch(entry, [], ["school:2", "school:1"])).toBe(true);
		expect(matchesSpellSearch(entry, [], ["self-target", "fellowship"])).toBe(
			true,
		);
	});
	it("matches abbreviations within words and treats repeated terms as redundant", () => {
		const entry = spellSearchEntry("Armor Other", null);
		expect(matchesSpellSearch(entry, spellSearchWords("amr oth"), [])).toBe(
			true,
		);
		expect(matchesSpellSearch(entry, spellSearchWords("armor armor"), [])).toBe(
			true,
		);
		expect(matchesSpellSearch(entry, spellSearchWords("armoth"), [])).toBe(
			false,
		);
	});
	it("handles punctuation, Unicode, empty input, and absent metadata", () => {
		expect(spellSearchWords(" Élan's—Acid! ")).toEqual(["élan", "s", "acid"]);
		const entry = spellSearchEntry("Spell 999", null);
		expect(matchesSpellSearch(entry, spellSearchWords("..."), [])).toBe(true);
		expect(matchesSpellSearch(entry, spellSearchWords("99"), [])).toBe(true);
		expect(matchesSpellSearch(entry, [], ["acid"])).toBe(false);
	});
});
