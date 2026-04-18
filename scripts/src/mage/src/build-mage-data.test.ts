import assert from "node:assert/strict";
import test from "node:test";

import { buildSpells } from "./cli/build-mage-data";
import type { MageSpellRecord } from "./types";

test("buildSpells updates template records in place using categories", () => {
	const template: Record<string, MageSpellRecord> = {
		fire: {
			spellId: 100,
			school: "war",
			type: "attack",
			difficulty: 1,
			damageType: "fire",
			range: 1,
			targetKind: "other",
		},
		vuln: {
			spellId: 200,
			school: "life",
			type: "heal",
			difficulty: 1,
			damageType: null,
			range: 5,
			targetKind: "other",
		},
	};

	const exported = {
		100: {
			name: "Totally Unhelpful Name",
			description: "Does not matter.",
			school: 1,
			category: 121,
			bitfield: 0,
			base_range_constant: 30,
			base_range_mod: 0,
			power: 125,
		},
		200: {
			name: "Still Unhelpful",
			description: "Does not matter either.",
			school: 2,
			category: 102,
			bitfield: 0,
			base_range_constant: 5,
			base_range_mod: 0,
			power: 125,
		},
	};

	const spells = buildSpells(template, exported);

	assert.deepEqual(spells.fire, {
		spellId: 100,
		school: "war",
		type: "attack",
		difficulty: 125,
		damageType: "fire",
		range: 30,
		targetKind: "other",
	});

	assert.deepEqual(spells.vuln, {
		spellId: 200,
		school: "life",
		type: "vuln",
		difficulty: 125,
		damageType: "acid",
		range: 5,
		targetKind: "other",
	});
});

test("buildSpells computes final range from base range and mod", () => {
	const template: Record<string, MageSpellRecord> = {
		fire: {
			spellId: 100,
			school: "war",
			type: "attack",
			difficulty: 1,
			damageType: "fire",
			range: 1,
			targetKind: "other",
		},
	};

	const exported = {
		100: {
			name: "Totally Unhelpful Name",
			description: "Does not matter.",
			school: 1,
			category: 121,
			bitfield: 0,
			base_range_constant: 30,
			base_range_mod: 0.7,
			power: 25,
		},
	};

	const spells = buildSpells(template, exported);

	assert.deepEqual(spells.fire, {
		spellId: 100,
		school: "war",
		type: "attack",
		difficulty: 25,
		damageType: "fire",
		range: 47.5,
		targetKind: "other",
	});
});

test("buildSpells filters self-targeted vuln spells", () => {
	const template: Record<string, MageSpellRecord> = {
		selfVuln: {
			spellId: 250,
			school: "life",
			type: "vuln",
			difficulty: 1,
			damageType: "acid",
			range: null,
			targetKind: "self",
		},
	};

	const exported = {
		250: {
			name: "Acid Vulnerability Self",
			description: "Weakens the caster.",
			school: 2,
			category: 102,
			bitfield: 8,
			base_range_constant: 0,
			base_range_mod: 0,
			power: 125,
		},
	};

	const spells = buildSpells(template, exported);

	assert.equal(spells.selfVuln, undefined);
});

test("buildSpells classifies transfer spells by resource pair", () => {
	const template: Record<string, MageSpellRecord> = {
		health: {
			spellId: 300,
			school: "life",
			type: "heal",
			difficulty: 1,
			damageType: null,
			range: null,
			targetKind: "self",
		},
		healthToMana: {
			spellId: 301,
			school: "life",
			type: "heal",
			difficulty: 1,
			damageType: null,
			range: null,
			targetKind: "self",
		},
		mana: {
			spellId: 302,
			school: "life",
			type: "heal",
			difficulty: 1,
			damageType: null,
			range: null,
			targetKind: "self",
		},
		manaToHealth: {
			spellId: 303,
			school: "life",
			type: "heal",
			difficulty: 1,
			damageType: null,
			range: null,
			targetKind: "self",
		},
	};

	const exported = {
		300: {
			name: "Rushed Recovery",
			description:
				"Drains one-half of the caster's Stamina and gives 175% of that to his/her Health.",
			school: 2,
			category: 89,
			bitfield: 8,
			base_range_constant: 0,
			base_range_mod: 0,
			power: 400,
		},
		301: {
			name: "Health to Mana Self IV",
			description:
				"Drains one-half of the caster's Health and gives 120% of that to his/her Mana (maximum of 200).",
			school: 2,
			category: 87,
			bitfield: 8,
			base_range_constant: 0,
			base_range_mod: 0,
			power: 400,
		},
		302: {
			name: "Meditative Trance",
			description:
				"Drains one-half of the caster's Stamina and gives 175% of that to his/her Mana.",
			school: 2,
			category: 89,
			bitfield: 8,
			base_range_constant: 0,
			base_range_mod: 0,
			power: 400,
		},
		303: {
			name: "Mana to Health Self V",
			description:
				"Drains one-half of the caster's Mana and gives 135% of that to his/her Health.",
			school: 2,
			category: 91,
			bitfield: 8,
			base_range_constant: 0,
			base_range_mod: 0,
			power: 400,
		},
	};

	const spells = buildSpells(template, exported);

	assert.deepEqual(spells.health, {
		spellId: 300,
		school: "life",
		type: "stamina-to-health",
		difficulty: 400,
		damageType: null,
		range: null,
		targetKind: "self",
	});

	assert.deepEqual(spells.healthToMana, {
		spellId: 301,
		school: "life",
		type: "health-to-mana",
		difficulty: 400,
		damageType: null,
		range: null,
		targetKind: "self",
	});

	assert.deepEqual(spells.mana, {
		spellId: 302,
		school: "life",
		type: "stamina-to-mana",
		difficulty: 400,
		damageType: null,
		range: null,
		targetKind: "self",
	});

	assert.deepEqual(spells.manaToHealth, {
		spellId: 303,
		school: "life",
		type: "mana-to-health",
		difficulty: 400,
		damageType: null,
		range: null,
		targetKind: "self",
	});
});

test("buildSpells filters non-missile war and void attack spells", () => {
	const template: Record<string, MageSpellRecord> = {
		heal: {
			spellId: 400,
			school: "life",
			type: "heal",
			difficulty: 1,
			damageType: null,
			range: 5,
			targetKind: "other",
		},
		warAttack: {
			spellId: 401,
			school: "war",
			type: "attack",
			difficulty: 1,
			damageType: "fire",
			range: 30,
			targetKind: "other",
		},
		voidAttack: {
			spellId: 402,
			school: "void",
			type: "attack",
			difficulty: 1,
			damageType: "void",
			range: 30,
			targetKind: "other",
		},
	};

	const exported = {
		400: {
			name: "Heal Other",
			description: "Restores health.",
			school: 2,
			category: 79,
			bitfield: 0,
			base_range_constant: 5,
			base_range_mod: 0,
			power: 1,
		},
		401: {
			name: "Ring of Fire",
			description: "A fiery ring.",
			school: 1,
			category: 226,
			bitfield: 0,
			base_range_constant: 15,
			base_range_mod: 0,
			power: 200,
		},
		402: {
			name: "Nether Ring",
			description: "A void ring.",
			school: 5,
			category: 641,
			bitfield: 0,
			base_range_constant: 15,
			base_range_mod: 0,
			power: 200,
		},
	};

	const spells = buildSpells(template, exported);

	assert.deepEqual(spells.heal, template.heal);
	assert.equal(spells.warAttack, undefined);
	assert.equal(spells.voidAttack, undefined);
});
