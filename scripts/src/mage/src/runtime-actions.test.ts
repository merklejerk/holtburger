import assert from "node:assert/strict";
import test from "node:test";

import {
	ATTACK_SPELL_TIMEOUT_SECONDS,
	PENDING_SPELL_BUSY_GRACE_SECONDS,
} from "./constants";
import {
	clearAttackHistory,
	clearHealingKitHistory,
	clearVulnerabilityAttemptHistory,
	followPartyLeader,
	hasRecentHealingKitSuccess,
	hasRecentMissedAttack,
	clearVulnerabilityHistory,
	hasRecentVulnerabilityCast,
	cancelCombatPlanning,
	interruptSpellcast,
	isCombatTargetAlive,
	healingKitUseBlocksPlanning,
	observeSpellCastBusy,
	resolveSpellcastFromCombatFeedback,
	resolveSpellcastFromChatMessage,
	resolveSpellcastFromIdle,
	resolveSpellcastFromTimeout,
	resolveSpellcastFromWeenieError,
	resolveHealingKitUseFromChatMessage,
	resolveHealingKitUseFromTimeout,
	useHealingKitOnTarget,
	spellcastBlocksPlanning,
	failedVulnAttemptCount,
} from "./runtime-actions";
import { createInitialState } from "./state";
import type {
	AttackRaySnapshot,
	MageRuntimeState,
	MageSpellcastRequest,
	MonsterCandidate,
} from "./types";

const testGlobal = globalThis as typeof globalThis & {
	HB: {
		log: () => void;
		debugLog: () => void;
		selfEntity?: () => ScriptSelfView | null;
		inventory?: () => Array<{ items: Guid[] }>;
		entity?: (guid?: Guid) => ScriptEntityView | ScriptSelfView | null;
		useWith?: (itemGuid: Guid, targetGuid: Guid) => void;
		currentInteraction?: () => { kind: string; data: { guid: Guid } } | null;
		cancelInteraction?: () => void;
		follow?: (guid: Guid) => void;
		distance?: (left: Guid, right: Guid) => number;
		party?: () => ScriptPartyView | null;
		entityExists?: (guid: Guid) => boolean;
	};
};

testGlobal.HB = {
	log: () => undefined,
	debugLog: () => undefined,
};

test("vulnerability history tracks successful casts per monster", () => {
	const state = createInitialState();
	const targetGuid = 101 as Guid;

	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);

	state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.set(targetGuid, 0);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), true);

	state.elapsedSeconds += 10 * 60;
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);
});

test("vulnerability history can be cleared when a monster disappears", () => {
	const state = createInitialState();
	const targetGuid = 202 as Guid;

	state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.set(targetGuid, 0);
	state.vulnerabilityPolicy.failedVulnAttemptsByTarget.set(targetGuid, 1);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), true);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 1);
	clearVulnerabilityHistory(state, targetGuid);

	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 0);
});

test("vulnerability success history survives disappearance while failed attempts clear", () => {
	const state = createInitialState();
	const targetGuid = 203 as Guid;

	state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.set(targetGuid, 0);
	state.vulnerabilityPolicy.failedVulnAttemptsByTarget.set(targetGuid, 2);

	clearVulnerabilityAttemptHistory(state, targetGuid);

	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), true);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 0);
});

test("combat engagement only tracks living targets", () => {
	assert.equal(isCombatTargetAlive(null), false);
	assert.equal(
		isCombatTargetAlive({
			motionCommand: { kind: "dead" },
		} as unknown as ScriptEntityView),
		false,
	);
	assert.equal(
		isCombatTargetAlive({
			motionCommand: { kind: "walking" },
		} as unknown as ScriptEntityView),
		true,
	);
});

test("attack timeout records a missed target and clears combat target", () => {
	const state = createInitialState();
	const targetGuid = 304 as Guid;
	const self = sampleSelfEntity();
	const target = sampleMonsterCandidate(targetGuid, 10, 0);

	state.combatTargetGuid = targetGuid;
	beginActiveSpellcast(state, {
		spellName: "Nether Bolt",
		spellId: 13,
		targetGuid,
		targetName: "Goblin",
		damageType: "void",
		kind: "attack",
		issuedAt: state.elapsedSeconds,
		attackRay: sampleAttackRay(),
	});

	state.elapsedSeconds = ATTACK_SPELL_TIMEOUT_SECONDS + 0.1;

	assert.equal(resolveSpellcastFromTimeout(state), true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(hasRecentMissedAttack(state, self, target), true);
	assert.equal(state.combatTargetGuid, null);
});

test("missed attack history can be cleared when a monster disappears", () => {
	const state = createInitialState();
	const targetGuid = 305 as Guid;

	state.attackPolicy.lastMissedAttackByTarget.set(targetGuid, {
		missedAt: 0,
		ray: sampleAttackRay(),
	});

	assert.equal(
		hasRecentMissedAttack(
			state,
			sampleSelfEntity(),
			sampleMonsterCandidate(targetGuid, 10, 0),
		),
		true,
	);

	clearAttackHistory(state, targetGuid);

	assert.equal(
		hasRecentMissedAttack(
			state,
			sampleSelfEntity(),
			sampleMonsterCandidate(targetGuid, 10, 0),
		),
		false,
	);
});

test("missed attack history does not block a changed ray", () => {
	const state = createInitialState();
	const targetGuid = 306 as Guid;

	state.attackPolicy.lastMissedAttackByTarget.set(targetGuid, {
		missedAt: 0,
		ray: sampleAttackRay(),
	});

	assert.equal(
		hasRecentMissedAttack(
			state,
			sampleSelfEntity(),
			sampleMonsterCandidate(targetGuid, 0, 10),
		),
		false,
	);
});

test("busy completion alone does not land attack or vulnerability casts", () => {
	const state = createInitialState();
	const targetGuid = 303 as Guid;

	beginAwaitingBusySpellcast(state, {
		spellName: "Fire Vulnerability",
		spellId: 1,
		targetGuid,
		targetName: "Goblin",
		damageType: "fire",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	observeSpellCastBusy(state);

	assert.equal(resolveSpellcastFromIdle(state), false);
	assert.equal(spellcastBlocksPlanning(state), true);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);
});

test("failed vulnerability casts do not update cooldown history", () => {
	const state = createInitialState();
	const targetGuid = 404 as Guid;

	beginAwaitingBusySpellcast(state, {
		spellName: "Cold Vulnerability",
		spellId: 2,
		targetGuid,
		targetName: "Goblin",
		damageType: "cold",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	state.elapsedSeconds = 2;

	assert.equal(resolveSpellcastFromIdle(state), true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 1);
});

test("pending casts are not treated as fizzles during the busy grace window", () => {
	const state = createInitialState();

	beginAwaitingBusySpellcast(state, {
		spellName: "Fire Vulnerability",
		spellId: 5,
		targetGuid: 606 as Guid,
		targetName: "Goblin",
		damageType: "fire",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	state.elapsedSeconds = PENDING_SPELL_BUSY_GRACE_SECONDS / 2;
	assert.equal(resolveSpellcastFromIdle(state), false);
	assert.equal(spellcastBlocksPlanning(state), true);

	state.elapsedSeconds = PENDING_SPELL_BUSY_GRACE_SECONDS;
	assert.equal(resolveSpellcastFromIdle(state), true);
	assert.equal(spellcastBlocksPlanning(state), false);
});

test("resist chat messages resolve the cast and record a vulnerability attempt", () => {
	const state = createInitialState();
	const targetGuid = 505 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Acid Vulnerability",
		spellId: 4,
		targetGuid,
		targetName: "Goblin",
		damageType: "acid",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	const handled = resolveSpellcastFromChatMessage(
		state,
		{
			sender: "Goblin",
			message: "Goblin resists your spell",
		},
		"Goblin",
	);

	assert.equal(handled, true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 1);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);
});

test("teleporting cancels active attack planning and clears miss cache", () => {
	const state = createInitialState();
	const targetGuid = 306 as Guid;

	state.combatTargetGuid = targetGuid;
	state.attackPolicy.lastMissedAttackByTarget.set(targetGuid, {
		missedAt: 0,
		ray: sampleAttackRay(),
	});
	beginActiveSpellcast(state, {
		spellName: "Nether Bolt",
		spellId: 14,
		targetGuid,
		targetName: "Goblin",
		damageType: "void",
		kind: "attack",
		issuedAt: state.elapsedSeconds,
		attackRay: sampleAttackRay(),
	});

	assert.equal(cancelCombatPlanning(state), true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(state.combatTargetGuid, null);
	assert.equal(state.attackPolicy.lastMissedAttackByTarget.size, 0);
});

test("stale follow is canceled when the player becomes the leader", () => {
	const state = createInitialState();
	const self = sampleSelfEntity();
	const followTarget = 307 as Guid;
	let cancelCount = 0;
	let followCount = 0;

	const hb: {
		log: () => void;
		debugLog: () => void;
		currentInteraction: () => { kind: "Follow"; data: { guid: Guid } } | null;
		cancelInteraction: () => void;
		follow: () => void;
	} = {
		log: () => undefined,
		debugLog: () => undefined,
		currentInteraction: () => ({
			kind: "Follow",
			data: { guid: followTarget },
		}),
		cancelInteraction: () => {
			cancelCount += 1;
		},
		follow: () => {
			followCount += 1;
		},
	};

	testGlobal.HB = hb;

	const handled = followPartyLeader(state, self, {
		guid: self.guid,
		name: self.name,
		healthPercent: null,
		staminaPercent: null,
		manaPercent: null,
	});

	assert.equal(handled, false);
	assert.equal(cancelCount, 1);
	assert.equal(followCount, 0);
});

test("resist chat messages without sender metadata still resolve the cast", () => {
	const state = createInitialState();
	const targetGuid = 506 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Acid Vulnerability",
		spellId: 4,
		targetGuid,
		targetName: "Goblin",
		damageType: "acid",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	const handled = resolveSpellcastFromChatMessage(
		state,
		{
			sender: null,
			message: "Goblin resists your spell",
		},
		"Goblin",
	);

	assert.equal(handled, true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 1);
});

test("timed out casts resolve and consume vulnerability attempt budget", () => {
	const state = createInitialState();
	const targetGuid = 707 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Lightning Vulnerability",
		spellId: 3,
		targetGuid,
		targetName: "Goblin",
		damageType: "lightning",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	state.elapsedSeconds = 8;

	assert.equal(resolveSpellcastFromTimeout(state), true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 1);
});

test("weenie errors resolve casts and consume vulnerability attempt budget", () => {
	const state = createInitialState();
	const targetGuid = 808 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Cold Vulnerability",
		spellId: 8,
		targetGuid,
		targetName: "Goblin",
		damageType: "cold",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	assert.equal(resolveSpellcastFromWeenieError(state), true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 1);
});

test("healing kits resolve from chat and block immediate retries until health catches up", () => {
	const state = createInitialState();
	const targetGuid = 9090 as Guid;
	let useWithCount = 0;

	testGlobal.HB = {
		...testGlobal.HB,
		selfEntity: () => sampleSelfEntity(),
		inventory: () => [
			{
				items: [101 as Guid],
			},
		],
		entity: (guid?: Guid) => {
			if (guid === (101 as Guid)) {
				return { kind: "healing_kit", guid } as unknown as ScriptEntityView;
			}
			if (guid === targetGuid) {
				return {
					guid,
					name: "Ally",
					kind: "player",
					weenieId: null,
					position: makePosition(1, 0, 0),
					motionCommand: { kind: "walking" },
					profile: null,
				} as unknown as ScriptEntityView;
			}
			return null;
		},
		useWith: () => {
			useWithCount += 1;
		},
	};

	state.elapsedSeconds = 0;
	assert.equal(useHealingKitOnTarget(state, targetGuid), true);
	assert.equal(useWithCount, 1);
	assert.equal(healingKitUseBlocksPlanning(state), true);

	assert.equal(
		resolveHealingKitUseFromChatMessage(
			state,
			{
				sender: "Self",
				message: "You heal Ally for 50 Health points.",
			},
			"Ally",
		),
		true,
	);
	assert.equal(healingKitUseBlocksPlanning(state), false);
	assert.equal(hasRecentHealingKitSuccess(state, targetGuid), true);

	state.elapsedSeconds = 1;
	assert.equal(useHealingKitOnTarget(state, targetGuid), false);
	assert.equal(useWithCount, 1);

	state.elapsedSeconds = 4;
	assert.equal(hasRecentHealingKitSuccess(state, targetGuid), false);
	assert.equal(useHealingKitOnTarget(state, targetGuid), true);
	assert.equal(useWithCount, 2);
});

test("healing kit failure chat clears the pending use", () => {
	const state = createInitialState();
	const targetGuid = 9091 as Guid;

	testGlobal.HB = {
		...testGlobal.HB,
		selfEntity: () => sampleSelfEntity(),
		entity: (guid?: Guid) =>
			guid === targetGuid
				? ({
						guid,
						name: "Ally",
						kind: "player",
						weenieId: null,
						position: makePosition(1, 0, 0),
						motionCommand: { kind: "walking" },
						profile: null,
					} as unknown as ScriptEntityView)
				: null,
	};

	state.healingKitPolicy.pendingUse = {
		targetGuid,
		targetName: "Ally",
		kitGuid: 101 as Guid,
		issuedAt: 0,
	};

	assert.equal(
		resolveHealingKitUseFromChatMessage(
			state,
			{
				sender: "Self",
				message: "You fail to heal Ally.",
			},
			"Ally",
		),
		true,
	);
	assert.equal(healingKitUseBlocksPlanning(state), false);
	assert.equal(hasRecentHealingKitSuccess(state, targetGuid), false);
});

test("healing kit pending use times out if no chat arrives", () => {
	const state = createInitialState();
	const targetGuid = 9092 as Guid;

	state.healingKitPolicy.pendingUse = {
		targetGuid,
		targetName: "Ally",
		kitGuid: 101 as Guid,
		issuedAt: 0,
	};
	state.elapsedSeconds = 9;

	assert.equal(resolveHealingKitUseFromTimeout(state), true);
	assert.equal(healingKitUseBlocksPlanning(state), false);
});

test("healing kit history clears when a target disappears", () => {
	const state = createInitialState();
	const targetGuid = 9093 as Guid;

	state.healingKitPolicy.pendingUse = {
		targetGuid,
		targetName: "Ally",
		kitGuid: 101 as Guid,
		issuedAt: 0,
	};
	state.healingKitPolicy.lastSuccessfulUseAtByTarget.set(targetGuid, 0);

	clearHealingKitHistory(state, targetGuid);

	assert.equal(healingKitUseBlocksPlanning(state), false);
	assert.equal(hasRecentHealingKitSuccess(state, targetGuid), false);
});

test("intentional follow interruptions do not consume vulnerability attempt budget", () => {
	const state = createInitialState();
	const targetGuid = 909 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Fire Vulnerability",
		spellId: 9,
		targetGuid,
		targetName: "Goblin",
		damageType: "fire",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	assert.equal(interruptSpellcast(state, "follow_override"), true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 0);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), false);
});

test("vulnerability landing chat messages resolve the cast and update cooldown history", () => {
	const state = createInitialState();
	const targetGuid = 1001 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Fire Vulnerability",
		spellId: 11,
		targetGuid,
		targetName: "Goblin",
		damageType: "fire",
		kind: "vulnerability",
		issuedAt: state.elapsedSeconds,
		attackRay: null,
	});

	const handled = resolveSpellcastFromChatMessage(
		state,
		{
			sender: "You",
			message:
				"You cast Fire Vulnerability on Goblin, surpassing Acid Vulnerability.",
		},
		"Goblin",
	);

	assert.equal(handled, true);
	assert.equal(spellcastBlocksPlanning(state), false);
	assert.equal(hasRecentVulnerabilityCast(state, targetGuid), true);
	assert.equal(failedVulnAttemptCount(state, targetGuid), 0);
});

test("attack landing chat messages resolve the cast", () => {
	const state = createInitialState();
	const targetGuid = 1002 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Nether Bolt",
		spellId: 12,
		targetGuid,
		targetName: "Goblin",
		damageType: "void",
		kind: "attack",
		issuedAt: state.elapsedSeconds,
		attackRay: sampleAttackRay(),
	});

	const handled = resolveSpellcastFromChatMessage(
		state,
		{
			sender: "You",
			message: "You twist Goblin for 42 points with Nether Bolt.",
		},
		"Goblin",
	);

	assert.equal(handled, true);
	assert.equal(spellcastBlocksPlanning(state), false);
});

test("combat victim notifications resolve attack casts", () => {
	const state = createInitialState();
	const targetGuid = 1003 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Crushing Shame",
		spellId: 13,
		targetGuid,
		targetName: "Olthoi Noble",
		damageType: "bludgeon",
		kind: "attack",
		issuedAt: state.elapsedSeconds,
		attackRay: sampleAttackRay(),
	});

	const handled = resolveSpellcastFromCombatFeedback(state, {
		kind: "victim_notification",
		data: {
			death_message: "Olthoi Noble is shattered by your assault!",
		},
	});

	assert.equal(handled, true);
	assert.equal(spellcastBlocksPlanning(state), false);
});

test("combat killer notifications resolve attack casts", () => {
	const state = createInitialState();
	const targetGuid = 1004 as Guid;

	beginActiveSpellcast(state, {
		spellName: "Crushing Shame",
		spellId: 13,
		targetGuid,
		targetName: "Olthoi Noble",
		damageType: "bludgeon",
		kind: "attack",
		issuedAt: state.elapsedSeconds,
		attackRay: sampleAttackRay(),
	});

	const handled = resolveSpellcastFromCombatFeedback(state, {
		kind: "killer_notification",
		data: {
			death_message: "Olthoi Noble is shattered by your assault!",
		},
	});

	assert.equal(handled, true);
	assert.equal(spellcastBlocksPlanning(state), false);
});

function beginAwaitingBusySpellcast(
	state: MageRuntimeState,
	request: MageSpellcastRequest,
): void {
	state.spellcast = {
		phase: "awaiting_busy",
		request,
	};
}

function beginActiveSpellcast(
	state: MageRuntimeState,
	request: MageSpellcastRequest,
): void {
	state.spellcast = {
		phase: "active",
		request,
		busySince: state.elapsedSeconds,
	};
}

function sampleSelfEntity(): ScriptSelfView {
	return {
		guid: 1 as Guid,
		name: "Self",
		position: makePosition(0, 0, 0),
		health: 100,
		healthMax: 100,
		stamina: 100,
		staminaMax: 100,
		mana: 100,
		manaMax: 100,
		encumbrance: 0,
		capacity: 0,
		busyOperation: "none",
		heading: 0,
		combatMode: 0 as unknown as CombatMode,
	};
}

function sampleMonsterCandidate(
	targetGuid: Guid,
	x: number,
	y: number,
): MonsterCandidate {
	return {
		guid: targetGuid,
		weenieId: 1,
		position: makePosition(x, y, 0),
		distanceToSelf: Math.hypot(x, y),
		distanceToParty: Math.hypot(x, y),
	};
}

function sampleAttackRay(): AttackRaySnapshot {
	return {
		from: makePosition(0, 0, 0),
		to: makePosition(10, 0, 0),
	};
}

function makePosition(x: number, y: number, z: number): WorldPosition {
	return {
		landblockId: 1 as Guid,
		coords: { x, y, z },
		rotation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
