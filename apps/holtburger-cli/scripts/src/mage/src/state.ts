import { MAX_AGGRO_DISTANCE, MAX_PARTY_DISTANCE } from "./constants";
import type { AttackMissRecord, MageRuntimeState } from "./types";

export function createInitialState(): MageRuntimeState {
	return {
		data: null,
		config: {
			preferredSpellIds: [],
			bannedSpellIds: [],
		},
		elapsedSeconds: 0,
		combatTargetGuid: null,
		spellcast: { phase: "idle" },
		partySeparationLatched: false,
		maxPartyDistance: MAX_PARTY_DISTANCE,
		maxAggroDistance: MAX_AGGRO_DISTANCE,
		actionTimes: new Map<string, number>(),
		attackPolicy: {
			lastMissedAttackByTarget: new Map<Guid, AttackMissRecord>(),
		},
		healingKitPolicy: {
			pendingUse: null,
			lastSuccessfulUseAtByTarget: new Map<Guid, number>(),
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
	state.maxPartyDistance = MAX_PARTY_DISTANCE;
	state.maxAggroDistance = MAX_AGGRO_DISTANCE;
	state.actionTimes.clear();
	state.attackPolicy.lastMissedAttackByTarget.clear();
	state.healingKitPolicy.pendingUse = null;
	state.healingKitPolicy.lastSuccessfulUseAtByTarget.clear();
	state.vulnerabilityPolicy.failedVulnAttemptsByTarget.clear();
	state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.clear();
}
