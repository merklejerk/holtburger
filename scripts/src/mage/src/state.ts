import type { AttackMissRecord, MageRuntimeState } from "./types";

export function createInitialState(): MageRuntimeState {
  return {
    data: null,
    elapsedSeconds: 0,
    combatTargetGuid: null,
    spellcast: { phase: "idle" },
    partySeparationLatched: false,
    actionTimes: new Map<string, number>(),
    attackPolicy: {
      lastMissedAttackByTarget: new Map<Guid, AttackMissRecord>(),
    },
    vulnerabilityPolicy: {
      failedVulnAttemptsByTarget: new Map<Guid, number>(),
      lastSuccessfulVulnAtByTarget: new Map<Guid, number>(),
    },
  };
}

export function resetState(state: MageRuntimeState): void {
  state.elapsedSeconds = 0;
  state.combatTargetGuid = null;
  state.spellcast = { phase: "idle" };
  state.partySeparationLatched = false;
  state.actionTimes.clear();
  state.attackPolicy.lastMissedAttackByTarget.clear();
  state.vulnerabilityPolicy.failedVulnAttemptsByTarget.clear();
  state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.clear();
}
