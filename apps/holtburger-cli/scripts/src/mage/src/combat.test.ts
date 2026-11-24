import assert from "node:assert/strict";
import test from "node:test";

import {
	HEALING_DISTANCE,
	PARTY_REVITALIZE_THRESHOLD,
	SELF_MANA_THRESHOLD,
	SELF_STAMINA_THRESHOLD,
} from "./constants";
import {
	collectMonsterCandidates,
	maybeRestoreMana,
	maybeRestoreStamina,
	maybeRevitalizePartyMember,
} from "./combat";
import type { Fellowship, FellowshipMember, MageSpellRecord } from "./types";
import { createInitialState } from "./state";
import { resolveCombatTarget } from "./runtime-actions";

const testGlobal = globalThis as typeof globalThis & {
	HB: {
		debugLog: typeof HB.debugLog;
		distance: (left: Guid, right: Guid) => number;
		castSpell: (spellId: number, targetGuid: Guid | null) => void;
		social: () => { fellowship: Fellowship | null };
		self: () => SelfView;
		entity: (guid?: Guid) => EntityDetail | null;
		entities?: (filter?: EntityFilter) => EntitySummary[];
	};
};

const recordedCasts: Array<{ spellId: number; targetGuid: Guid | null }> = [];
let activeSelf: SelfView;
activeSelf = sampleSelf({ stamina: 1, mana: 1 });

testGlobal.HB = {
	debugLog: () => undefined,
	distance: () => 0,
	castSpell: (spellId, targetGuid) => {
		recordedCasts.push({ spellId, targetGuid });
	},
	social: () => ({ fellowship: null }),
	self: () => activeSelf,
	entity: () => null,
};

test("maybeRestoreStamina casts a stamina recovery spell when stamina is low", () => {
	recordedCasts.length = 0;
	const state = createInitialState();
	const self = sampleSelf({
		stamina: SELF_STAMINA_THRESHOLD / 2,
		mana: 1,
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
		stamina: SELF_STAMINA_THRESHOLD / 2,
		mana: SELF_MANA_THRESHOLD / 2,
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
		stamina: (1 + SELF_STAMINA_THRESHOLD) / 2,
		mana: SELF_MANA_THRESHOLD / 2,
	});
	const spells = [makeSpell({ spellId: 12, type: "stamina-to-mana" })];

	const restored = maybeRestoreMana(state, self, spells);

	assert.equal(restored, true);
	assert.deepEqual(recordedCasts.pop(), { spellId: 12, targetGuid: self.guid });
});

test("maybeRevitalizePartyMember casts revitalize on low stamina party members", () => {
	recordedCasts.length = 0;
	const state = createInitialState();
	const self = sampleSelf({ stamina: 1, mana: 1 });
	const lowStaminaMember = samplePartyMember(2, PARTY_REVITALIZE_THRESHOLD / 2);
	const higherStaminaMember = samplePartyMember(
		3,
		(1 + PARTY_REVITALIZE_THRESHOLD) / 2,
	);
	const entityByGuid = new Map<Guid, EntityDetail>([
		[lowStaminaMember.guid, sampleEntityDetail(sampleEntity())],
		[higherStaminaMember.guid, sampleEntityDetail(sampleEntity())],
	]);
	testGlobal.HB = {
		...testGlobal.HB,
		social: () => ({
			fellowship: {
				name: "Test Fellowship",
				leader_guid: self.guid,
				members: [lowStaminaMember, higherStaminaMember],
			},
		}),
		entity: (guid?: Guid) =>
			guid == null ? null : (entityByGuid.get(guid) ?? null),
		distance: () => HEALING_DISTANCE / 2,
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

function sampleSelf(vitals: Pick<SelfView, "stamina" | "mana">): SelfView {
	const self: SelfView = {
		guid: 1 as Guid,
		name: "Self",
		position: {
			landblock_id: 1 as Guid,
			coords: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		heading: 0,
		health: 100,
		healthMax: 100,
		staminaMax: 1,
		manaMax: 1,
		pyreals: 0,
		burden: 0,
		combatMode: "peace",
		busy: null,
		confirmation: null,
		spellCastTarget: null,
		navigation: null,
		serverTime: 0,
		...vitals,
	};
	activeSelf = self;
	return self;
}

function samplePartyMember(
	guid: number,
	staminaPercent: number,
): FellowshipMember {
	return {
		guid: guid as Guid,
		name: `Party ${guid}`,
		level: 50,
		max_health: 100,
		max_stamina: 100,
		max_mana: 100,
		current_health: 100,
		current_stamina: Math.round(staminaPercent * 100),
		current_mana: 100,
	};
}

function sampleEntity(): EntitySummary {
	return {
		guid: 999 as Guid,
		name: "Entity",
		wcid: null,
		category: "player",
		isHostile: false,
		isDead: false,
		isVendor: false,
		position: {
			landblock_id: 1 as Guid,
			coords: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		distanceToSelf: 0,
		healthFraction: 1,
		stackCount: null,
		container: null,
		wielder: null,
	};
}

function sampleEntityDetail(summary: EntitySummary): EntityDetail {
	return {
		summary,
		facts: null,
		properties: null,
		creatureProfile: null,
		weaponProfile: null,
		armorProfile: null,
	};
}

// Exercise acquisition and retention with the same script-facing contract.
test("mage acquires only hostile monsters and drops a retained summon", () => {
	const self = sampleSelf({ stamina: 1, mana: 1 });
	const mob: EntitySummary = {
		...sampleEntity(),
		guid: 2 as Guid,
		category: "monster",
		isHostile: true,
	};
	const summon: EntitySummary = {
		...mob,
		guid: 3 as Guid,
		isHostile: false,
	};
	const pvp: EntitySummary = { ...mob, guid: 4 as Guid, category: "player" };
	const context = {
		...testGlobal.HB,
		entities: () => [summon, mob, pvp, { ...mob, isDead: true }],
		entity: () => sampleEntityDetail(mob),
		distance: () => 0,
	};
	testGlobal.HB = context;
	assert.deepEqual(
		collectMonsterCandidates(self, null, 10, 10).map(
			(candidate) => candidate.guid,
		),
		[mob.guid],
	);
	const state = createInitialState();
	state.combatTargetGuid = mob.guid;
	assert.equal(resolveCombatTarget(state, self, null, 10)?.guid, mob.guid);
	mob.isHostile = false;
	assert.equal(resolveCombatTarget(state, self, null, 10), null);
	assert.equal(state.combatTargetGuid, null);
	mob.isHostile = true;
	mob.isDead = true;
	state.combatTargetGuid = mob.guid;
	assert.equal(resolveCombatTarget(state, self, null, 10), null);
	assert.equal(state.combatTargetGuid, null);
});
