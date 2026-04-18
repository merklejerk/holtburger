import assert from "node:assert/strict";
import test from "node:test";

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
  assert.equal(
    isMonsterCandidateInCombatRange(
      makeCandidate(40, { distanceToSelf: 56, distanceToParty: 20 }),
      30,
    ),
    false,
  );
  assert.equal(
    isMonsterCandidateInCombatRange(
      makeCandidate(41, { distanceToSelf: 57, distanceToParty: 20 }),
      30,
    ),
    false,
  );
  assert.equal(
    isMonsterCandidateInCombatRange(
      makeCandidate(42, { distanceToSelf: 20, distanceToParty: 33 }),
      30,
    ),
    true,
  );
});

test("isMonsterCandidateInCombatRange caps aggro distance before attack range", () => {
  assert.equal(
    isMonsterCandidateInCombatRange(
      makeCandidate(43, { distanceToSelf: 41, distanceToParty: 20 }),
      100,
    ),
    false,
  );
  assert.equal(
    isMonsterCandidateInCombatRange(
      makeCandidate(44, { distanceToSelf: 40, distanceToParty: 20 }),
      100,
    ),
    true,
  );
});
