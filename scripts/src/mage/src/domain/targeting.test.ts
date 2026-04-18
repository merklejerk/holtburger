import assert from "node:assert/strict";
import test from "node:test";

import { MAX_AGGRO_DISTANCE } from "../constants";
import {
	isMonsterCandidateInCombatRange,
	selectAttackTarget,
	updatePartySeparation,
} from "./targeting";
import type { MonsterCandidate } from "../types";

function makeCandidate(
	guid: number,
	overrides: Partial<MonsterCandidate> = {},
): MonsterCandidate {
	return {
		guid: guid as Guid,
		weenieId: 1,
		position: {
			landblockId: 1 as Guid,
			coords: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		distanceToSelf: 10,
		distanceToParty: 10,
		...overrides,
	};
}

test("updatePartySeparation latches when the leader gets too far away", () => {
	const separation = updatePartySeparation(false, 40);

	assert.deepEqual(separation, {
		shouldFollow: true,
		distance: 40,
		nextLatched: true,
	});
});

test("selectAttackTarget prefers party proximity when grouped", () => {
	const selection = selectAttackTarget(
		[
			makeCandidate(20, { distanceToParty: 12, distanceToSelf: 2 }),
			makeCandidate(30, { distanceToParty: 4, distanceToSelf: 9 }),
		],
		true,
	);

	assert.equal(selection.target?.guid, 30);
	assert.equal(selection.nextCombatTargetGuid, 30);
});

test("isMonsterCandidateInCombatRange matches acquisition and retention rules", () => {
	const withinAggroDistance = MAX_AGGRO_DISTANCE;
	const outsideAggroDistance = MAX_AGGRO_DISTANCE + 1;

	assert.equal(
		isMonsterCandidateInCombatRange(
			makeCandidate(40, {
				distanceToSelf: outsideAggroDistance,
				distanceToParty: 20,
			}),
			withinAggroDistance,
		),
		false,
	);
	assert.equal(
		isMonsterCandidateInCombatRange(
			makeCandidate(41, {
				distanceToSelf: outsideAggroDistance,
				distanceToParty: 20,
			}),
			withinAggroDistance,
		),
		false,
	);
	assert.equal(
		isMonsterCandidateInCombatRange(
			makeCandidate(42, {
				distanceToSelf: withinAggroDistance,
				distanceToParty: 33,
			}),
			withinAggroDistance,
		),
		true,
	);
});

test("isMonsterCandidateInCombatRange caps aggro distance before attack range", () => {
	const maxAttackRange = MAX_AGGRO_DISTANCE + 100;
	const withinAggroDistance = MAX_AGGRO_DISTANCE;
	const outsideAggroDistance = MAX_AGGRO_DISTANCE + 1;

	assert.equal(
		isMonsterCandidateInCombatRange(
			makeCandidate(43, {
				distanceToSelf: outsideAggroDistance,
				distanceToParty: 20,
			}),
			maxAttackRange,
		),
		false,
	);
	assert.equal(
		isMonsterCandidateInCombatRange(
			makeCandidate(44, {
				distanceToSelf: withinAggroDistance,
				distanceToParty: 20,
			}),
			maxAttackRange,
		),
		true,
	);
});
