import assert from "node:assert/strict";
import test from "node:test";

import { SELF_STAMINA_THRESHOLD } from "./constants";
import {
	maybeRestoreMana,
	maybeRestoreStamina,
	maybeRevitalizePartyMember,
} from "./combat";
import type { MageSpellRecord } from "./types";
import { createInitialState } from "./state";

const testGlobal = globalThis as typeof globalThis & {
	HB: {
		log: (level: string, message: string) => void;
		distance: (left: Guid, right: Guid) => number;
		castSpell: (spellId: number, targetGuid: Guid | null) => void;
		party: () => ScriptPartyView | null;
		entityExists: (guid: Guid) => boolean;
		selfEntity: () => ScriptSelfView | null;
		entity: (guid?: Guid) => ScriptSelfView | ScriptEntityView | null;
	};
};

const recordedCasts: Array<{ spellId: number; targetGuid: Guid | null }> = [];
let activeSelf: ScriptSelfView | null = null;

testGlobal.HB = {
	log: () => undefined,
	distance: () => 0,
	castSpell: (spellId, targetGuid) => {
		recordedCasts.push({ spellId, targetGuid });
	},
	party: () => null,
	entityExists: () => false,
	selfEntity: () => activeSelf,
	entity: () => activeSelf,
};

test("maybeRestoreStamina casts a stamina recovery spell when stamina is low", () => {
	recordedCasts.length = 0;
	const state = createInitialState();
	const self = sampleSelf({
		stamina: 20,
		staminaMax: 100,
		mana: 80,
		manaMax: 100,
	});
	const spells = [makeSpell({ spellId: 10, type: "revitalize" })];

	const restored = maybeRestoreStamina(state, self, spells);

	assert.equal(restored, true);
	assert.deepEqual(recordedCasts.pop(), { spellId: 10, targetGuid: self.guid });
});

test("maybeRestoreMana does not spend stamina when stamina is already low", () => {
	recordedCasts.length = 0;
	const state = createInitialState();
	const self = sampleSelf({
		stamina: 20,
		staminaMax: 100,
		mana: 20,
		manaMax: 100,
	});
	const spells = [makeSpell({ spellId: 11, type: "stamina-to-mana" })];

	const restored = maybeRestoreMana(state, self, spells);

	assert.equal(restored, false);
	assert.equal(recordedCasts.length, 0);
});

test("maybeRestoreMana still uses stamina-to-mana above the stamina threshold", () => {
	recordedCasts.length = 0;
	const state = createInitialState();
	const self = sampleSelf({
		stamina: 80,
		staminaMax: 100,
		mana: 20,
		manaMax: 100,
	});
	const spells = [makeSpell({ spellId: 12, type: "stamina-to-mana" })];

	const restored = maybeRestoreMana(state, self, spells);

	assert.equal(restored, true);
	assert.deepEqual(recordedCasts.pop(), { spellId: 12, targetGuid: self.guid });
});

test("stamina threshold matches the mana threshold by default", () => {
	assert.equal(SELF_STAMINA_THRESHOLD, 0.6);
});

test("maybeRevitalizePartyMember casts revitalize on low stamina party members", () => {
	recordedCasts.length = 0;
	const state = createInitialState();
	const self = sampleSelf({
		stamina: 90,
		staminaMax: 100,
		mana: 80,
		manaMax: 100,
	});
	const lowStaminaMember = samplePartyMember(2, 0.4);
	const higherStaminaMember = samplePartyMember(3, 0.8);
	const entityByGuid = new Map<Guid, ScriptEntityView>([
		[lowStaminaMember.guid, sampleEntity()],
		[higherStaminaMember.guid, sampleEntity()],
	]);
	testGlobal.HB = {
		...testGlobal.HB,
		party: () => ({
			leaderGuid: self.guid,
			members: [lowStaminaMember, higherStaminaMember],
		}),
		entityExists: (guid) => entityByGuid.has(guid),
		entity: (guid?: Guid) =>
			guid == null ? null : (entityByGuid.get(guid) ?? null),
		distance: () => 10,
	};
	const spells = [
		makeSpell({ spellId: 20, type: "revitalize", targetKind: "other" }),
	];

	const cast = maybeRevitalizePartyMember(state, self, spells);

	assert.equal(cast, true);
	assert.deepEqual(recordedCasts.pop(), {
		spellId: 20,
		targetGuid: lowStaminaMember.guid,
	});
});

function makeSpell(overrides: Partial<MageSpellRecord>): MageSpellRecord {
	return {
		name: "Test Spell",
		spellId: 1,
		school: "life",
		type: "revitalize",
		difficulty: 1,
		damageType: null,
		range: null,
		targetKind: "self",
		...overrides,
	};
}

function sampleSelf(
	overrides: Partial<ScriptSelfView> & {
		stamina: number;
		staminaMax: number;
		mana: number;
		manaMax: number;
	},
): ScriptSelfView {
	const self = {
		guid: 1 as Guid,
		name: "Self",
		position: {
			landblockId: 1 as Guid,
			coords: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		health: 100,
		healthMax: 100,
		encumbrance: 0,
		capacity: 0,
		busyOperation: "none",
		heading: 0,
		combatMode: 0 as unknown as CombatMode,
		...overrides,
	} as ScriptSelfView;
	activeSelf = self;
	return self;
}

function samplePartyMember(
	guid: number,
	staminaPercent: number,
): ScriptPartyMemberView {
	return {
		guid: guid as Guid,
		name: `Party ${guid}`,
		healthPercent: 1,
		staminaPercent,
		manaPercent: 1,
	};
}

function sampleEntity(): ScriptEntityView {
	return {
		guid: 999 as Guid,
		name: "Entity",
		weenieId: null,
		kind: "player",
		position: {
			landblockId: 1 as Guid,
			coords: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		motionCommand: { kind: "walking" },
		profile: null,
	} as unknown as ScriptEntityView;
}
