import assert from "node:assert/strict";
import test from "node:test";

import type { MageData, MageSpellRecord } from "./types";
import { normalizeMageConfig } from "./runtime-config";

test("normalizeMageConfig resolves preferred and banned spells by id and key", () => {
	const data = makeMageData();

	assert.deepEqual(
		normalizeMageConfig(
			{
				preferredSpells: ["flame-bolt-i", 28, "missing", 27, "flame-bolt-ii"],
				bannedSpells: [28, "flame-bolt-i", "missing", 27, 28],
			},
			data,
		),
		{
			preferredSpellIds: [27, 28],
			bannedSpellIds: [28, 27],
		},
	);
});

test("normalizeMageConfig defaults missing config to empty spell lists", () => {
	assert.deepEqual(normalizeMageConfig(null, makeMageData()), {
		preferredSpellIds: [],
		bannedSpellIds: [],
	});
});

function makeMageData(): MageData {
	return {
		spells: {
			"flame-bolt-i": makeSpell(27, "war"),
			"flame-bolt-ii": makeSpell(28, "war"),
		},
		skills: {},
		weenieResists: new Uint8Array(),
	};
}

function makeSpell(
	spellId: number,
	school: MageSpellRecord["school"],
): MageSpellRecord {
	return {
		spellId,
		school,
		type: "attack",
		difficulty: 1,
		damageType: null,
		range: null,
		targetKind: "other",
	};
}
