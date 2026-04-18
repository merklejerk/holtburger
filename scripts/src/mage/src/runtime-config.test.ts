import assert from "node:assert/strict";
import test from "node:test";

import type { MageData, MageSpellRecord } from "./types";
import { loadMageConfig, normalizeMageConfig } from "./runtime-config";

const testGlobal = globalThis as typeof globalThis & {
	HB: {
		loadConfig: () => unknown;
		writeConfig: (contents: unknown) => boolean;
	};
};

test("normalizeMageConfig resolves preferred spells by id and key", () => {
	const data = makeMageData();

	assert.deepEqual(
		normalizeMageConfig(
			{
				preferredSpells: ["flame-bolt-i", 28, "missing", 27, "flame-bolt-ii"],
			},
			data,
		),
		{
			preferredSpellIds: [27, 28],
		},
	);
});

test("normalizeMageConfig defaults missing config to empty preferences", () => {
	assert.deepEqual(normalizeMageConfig(null, makeMageData()), {
		preferredSpellIds: [],
	});
});

test("loadMageConfig writes an empty config when none exists", () => {
	const writes: unknown[] = [];
	testGlobal.HB = {
		loadConfig: () => null,
		writeConfig: (contents) => {
			writes.push(contents);
			return true;
		},
	};

	assert.deepEqual(loadMageConfig(makeMageData()), {
		preferredSpellIds: [],
	});
	assert.deepEqual(writes, [{ preferredSpells: [] }]);
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
