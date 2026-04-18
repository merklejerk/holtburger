import {
  MAX_AGGRO_DISTANCE,
  MAX_PARTY_DISTANCE,
  PARTY_RESUME_DISTANCE,
} from "../constants";
import type {
  AttackTargetSelection,
  MonsterCandidate,
  PartySeparation,
} from "../types";

export function isMonsterCandidateInCombatRange(
  candidate: MonsterCandidate,
  maxAttackRange: number,
): boolean {
  return (
    candidate.distanceToSelf <= Math.min(MAX_AGGRO_DISTANCE, maxAttackRange)
  );
}

export function updatePartySeparation(
  currentLatched: boolean,
  distanceToLeader: number | null,
): PartySeparation {
  if (distanceToLeader == null) {
    return {
      shouldFollow: false,
      distance: null,
      nextLatched: false,
    };
  }

  if (distanceToLeader > MAX_PARTY_DISTANCE) {
    return {
      shouldFollow: true,
      distance: distanceToLeader,
      nextLatched: true,
    };
  }

  if (currentLatched && distanceToLeader <= PARTY_RESUME_DISTANCE) {
    return {
      shouldFollow: false,
      distance: distanceToLeader,
      nextLatched: false,
    };
  }

  return {
    shouldFollow: currentLatched,
    distance: distanceToLeader,
    nextLatched: currentLatched,
  };
}

export function selectAttackTarget(
  candidates: MonsterCandidate[],
  hasPartyLeader: boolean,
): AttackTargetSelection {
  const sorted = [...candidates].sort((left, right) => {
    if (hasPartyLeader) {
      if (left.distanceToParty !== right.distanceToParty) {
        return left.distanceToParty - right.distanceToParty;
      }
    } else if (left.distanceToSelf !== right.distanceToSelf) {
      return left.distanceToSelf - right.distanceToSelf;
    }

    return left.guid - right.guid;
  });

  const chosen = sorted[0] ?? null;
  if (chosen == null) {
    return {
      nextCombatTargetGuid: null,
      target: null,
    };
  }

  return {
    nextCombatTargetGuid: chosen.guid,
    target: {
      guid: chosen.guid,
      reason: hasPartyLeader ? "party-nearest-monster" : "nearest-monster",
      weenieId: chosen.weenieId,
    },
  };
}
