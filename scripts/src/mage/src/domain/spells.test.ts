import assert from "node:assert/strict";
import test from "node:test";

import { SPELL_SKILL_HEADROOM } from "../constants";
import {
	availableSpells,
	chooseBestSpell,
	preferredDamageTypesForWeenie,
} from "./spells";
import type { MageData, MageSpellRecord, SkillSnapshot } from "../types";

function makeSpell(overrides: Partial<MageSpellRecord>): MageSpellRecord {
	return {
		spellId: 1,
		school: "war",
		type: "attack",
		difficulty: 100,
		damageType: "fire",
		range: 20,
		targetKind: "other",
		...overrides,
	};
}

test("availableSpells filters by spellbook and skill headroom", () => {
	const skillEffective = 100;
	const castableDifficulty = skillEffective - SPELL_SKILL_HEADROOM;
	const blockedDifficulty = castableDifficulty + 1;

	const data: MageData = {
		spells: {
			fire: makeSpell({ spellId: 100, difficulty: castableDifficulty }),
			cold: makeSpell({
				spellId: 200,
				difficulty: blockedDifficulty,
				damageType: "cold",
			}),
		},
		skills: {
			war: 34,
		},
		weenieResists: new Uint8Array(),
	};
	const spellbook = new Set([100, 200]);
	const skills = new Map<string, SkillSnapshot>([
		[
			"war",
			{
				skillId: 34,
				effective: skillEffective,
				training: "Specialized",
			},
		],
	]);

	const spells = availableSpells(data, spellbook, skills);

	assert.deepEqual(
		spells.map((spell) => spell.spellId),
		[100],
	);
});

test("chooseBestSpell prefers vulnerability-aligned spells before raw difficulty", () => {
	const spells = [
		makeSpell({ spellId: 100, damageType: "fire" }),
		makeSpell({ spellId: 200, damageType: "cold" }),
	];

	const chosen = chooseBestSpell(
		spells,
		{
			school: "war",
			type: "attack",
			targetKind: "other",
			targetGuid: 222 as Guid,
			selfGuid: 111 as Guid,
			preferredDamageTypes: ["cold"],
		},
		() => 10,
	);

	assert.equal(chosen?.spellId, 200);
});

test("chooseBestSpell prefers higher difficulty before configured spell ids", () => {
	const spells = [
		makeSpell({ spellId: 100, difficulty: 150, damageType: "fire" }),
		makeSpell({ spellId: 200, difficulty: 175, damageType: "fire" }),
	];

	const chosen = chooseBestSpell(
		spells,
		{
			school: "war",
			type: "attack",
			targetKind: "other",
			targetGuid: 222 as Guid,
			selfGuid: 111 as Guid,
			preferredSpellIds: [100],
		},
		() => 10,
	);

	assert.equal(chosen?.spellId, 200);
});

test("chooseBestSpell falls back to configured spell ids after damage and difficulty tie", () => {
	const spells = [
		makeSpell({ spellId: 100, difficulty: 150, damageType: "fire" }),
		makeSpell({ spellId: 200, difficulty: 150, damageType: "fire" }),
	];

	const chosen = chooseBestSpell(
		spells,
		{
			school: "war",
			type: "attack",
			targetKind: "other",
			targetGuid: 222 as Guid,
			selfGuid: 111 as Guid,
			preferredSpellIds: [100],
		},
		() => 10,
	);

	assert.equal(chosen?.spellId, 100);
});

test("chooseBestSpell does not promote preferred spell ids that fail filters", () => {
	const spells = [
		makeSpell({ spellId: 100, range: 10 }),
		makeSpell({ spellId: 200, range: 30, difficulty: 175, damageType: "cold" }),
	];

	const chosen = chooseBestSpell(
		spells,
		{
			school: "war",
			type: "attack",
			targetKind: "other",
			targetGuid: 222 as Guid,
			selfGuid: 111 as Guid,
			preferredSpellIds: [100],
		},
		() => 20,
	);

	assert.equal(chosen?.spellId, 200);
});

test("chooseBestSpell rejects out-of-range spells", () => {
	const spell = makeSpell({ spellId: 100, range: 15 });

	const chosen = chooseBestSpell(
		[spell],
		{
			school: "war",
			type: "attack",
			targetKind: "other",
			targetGuid: 222 as Guid,
			selfGuid: 111 as Guid,
		},
		() => 20,
	);

	assert.equal(chosen, null);
});

test("preferredDamageTypesForWeenie prefers higher resist values first", () => {
	const resistWord =
		123n | (15n << 44n) | (10n << 40n) | (4n << 24n) | (1n << 28n);
	const weenieResists = new Uint8Array(8);
	new DataView(weenieResists.buffer).setBigUint64(0, resistWord, true);

	const data: MageData = {
		spells: {},
		skills: {},
		weenieResists,
	};

	assert.deepEqual(preferredDamageTypesForWeenie(data, 123), [
		"direct",
		"fire",
		"cold",
		"pierce",
		"bludgeon",
		"acid",
		"lightning",
		"slash",
		"void",
	]);
});
