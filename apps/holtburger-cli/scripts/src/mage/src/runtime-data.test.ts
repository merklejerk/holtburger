import assert from "node:assert/strict";
import test from "node:test";

import { filterMageDataSpells, normalizeMageData } from "./runtime-data";

test("normalizeMageData flattens grouped spell tables", () => {
	const data = normalizeMageData(
		{
			skills: {
				war: 34,
			},
			spells: {
				war: {
					fireBolt: {
						name: "Fire Bolt",
						spellId: 100,
						type: "attack",
						difficulty: 125,
						targetKind: "other",
						damageType: "fire",
						range: 30,
					},
				},
				life: {
					healSelf: {
						name: "Heal Self",
						spellId: 200,
						type: "revitalize",
						difficulty: 1,
						targetKind: "self",
					},
				},
				void: {},
			},
		},
		new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
	);

	assert.deepEqual(data?.spells.fireBolt, {
		name: "Fire Bolt",
		spellId: 100,
		school: "war",
		type: "attack",
		difficulty: 125,
		damageType: "fire",
		range: 30,
		targetKind: "other",
	});
	assert.deepEqual(data?.spells.healSelf, {
		name: "Heal Self",
		spellId: 200,
		school: "life",
		type: "revitalize",
		difficulty: 1,
		damageType: null,
		range: null,
		targetKind: "self",
	});
	assert.equal(data?.weenieResists.byteLength, 8);
});

test("normalizeMageData accepts array-shaped resist bytes", () => {
	const data = normalizeMageData(
		{
			skills: {},
			spells: {
				war: {},
				life: {},
				void: {},
			},
		},
		[1, 0, 0, 0, 0, 0, 0, 0],
	);

	assert.equal(data?.weenieResists instanceof Uint8Array, true);
	assert.equal(data?.weenieResists.byteLength, 8);
});

test("filterMageDataSpells removes banned spell ids from the spell db", () => {
	const data = normalizeMageData(
		{
			skills: {},
			spells: {
				war: {
					fireBolt: {
						name: "Fire Bolt",
						spellId: 100,
						type: "attack",
						difficulty: 125,
						targetKind: "other",
						damageType: "fire",
						range: 30,
					},
				},
				life: {
					healSelf: {
						name: "Heal Self",
						spellId: 200,
						type: "revitalize",
						difficulty: 1,
						targetKind: "self",
					},
				},
				void: {},
			},
		},
		new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
	);

	const filtered = filterMageDataSpells(data, [200]);

	assert.deepEqual(Object.keys(filtered?.spells ?? {}), ["fireBolt"]);
});
