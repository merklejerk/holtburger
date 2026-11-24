import {
	availableSpells,
	knownAttackSpells,
	maxSpellRange,
} from "./domain/spells";
import { selectAttackTarget, updatePartySeparation } from "./domain/targeting";
import {
	collectMonsterCandidates,
	maybeCastAttackSpell,
	maybeHealPartyMember,
	maybeRevitalizePartyMember,
	maybeRestoreHealth,
	maybeRestoreMana,
	maybeRestoreStamina,
} from "./combat";
import { currentFellowship, partyLeaderMember } from "./party";
import {
	clearNonMageInteraction,
	followPartyLeader,
	hasRecentMissedAttack,
	healingKitUseBlocksPlanning,
	interruptSpellcast,
	isFollowingTarget,
	observeSpellCastBusy,
	resolveHealingKitUseFromTimeout,
	resolveCombatTarget,
	logMageInfo,
	setCombatTarget,
	resolveSpellcastFromIdle,
	resolveSpellcastFromTimeout,
	spellcastBlocksPlanning,
} from "./runtime-actions";
import { currentSkills, currentSpellbook } from "./skills";
import type { AttackTarget, MageRuntimeState } from "./types";

export function runMage(state: MageRuntimeState): void {
	const self = HB.self();
	const data = state.data;
	if (self == null || !self.guid || data == null) {
		return;
	}

	const spellbook = currentSpellbook();
	const skills = currentSkills(data);
	const spells = availableSpells(data, spellbook, skills);
	const warAttackSpells = knownAttackSpells(spells, "war");
	const voidAttackSpells = knownAttackSpells(spells, "void");
	const attackRange =
		maxSpellRange([...warAttackSpells, ...voidAttackSpells]) ?? 0;

	if (clearNonMageInteraction(state, self)) {
		return;
	}

	const party = currentFellowship();
	const partyLeader = partyLeaderMember(party);
	const separation = updatePartySeparation(
		state.partySeparationLatched,
		partyLeader == null ? null : HB.distance(self.guid, partyLeader.guid),
		state.maxPartyDistance,
	);
	state.partySeparationLatched = separation.nextLatched;

	if (partyLeader != null && separation.shouldFollow) {
		if (spellcastBlocksPlanning(state)) {
			logMageInfo(
				`follow override -> interrupting spellcast for leader ${partyLeader.guid}`,
			);
			interruptSpellcast(state, "follow_override");
			if (self.busy != null) {
				HB.stopCombat();
				HB.stopMovement();
			}
		}

		followPartyLeader(state, self, partyLeader);
		return;
	}

	let bypassBusy = false;
	if (spellcastBlocksPlanning(state)) {
		if (self.busy === "spell-cast") {
			observeSpellCastBusy(state);
		}

		if (resolveSpellcastFromTimeout(state)) {
			bypassBusy = true;
			if (self.busy != null) {
				HB.stopCombat();
				HB.stopMovement();
			}
		} else if (self.busy == null) {
			resolveSpellcastFromIdle(state);
			if (spellcastBlocksPlanning(state)) {
				return;
			}
		} else {
			return;
		}
	}

	if (healingKitUseBlocksPlanning(state)) {
		if (!resolveHealingKitUseFromTimeout(state)) {
			return;
		}
	}

	if (self.busy != null && !bypassBusy) {
		return;
	}

	if (maybeRestoreHealth(state, self, spells, skills)) {
		return;
	}

	if (maybeRestoreStamina(state, self, spells)) {
		return;
	}

	if (maybeRestoreMana(state, self, spells)) {
		return;
	}

	if (maybeHealPartyMember(state, self, spells, skills)) {
		return;
	}

	if (maybeRevitalizePartyMember(state, self, spells)) {
		return;
	}

	let target: AttackTarget | null = null;
	const activeCombatTarget = resolveCombatTarget(
		state,
		self,
		partyLeader,
		attackRange,
	);
	if (activeCombatTarget != null) {
		target = {
			guid: activeCombatTarget.guid,
			reason: "combat-target",
			weenieId: activeCombatTarget.wcid,
		};
		logMageInfo(`combat target resolved -> ${describeAttackTarget(target)}`);
	} else {
		const candidates = collectMonsterCandidates(
			self,
			partyLeader,
			attackRange,
			state.maxAggroDistance,
		);
		const availableCandidates = candidates.filter(
			(candidate) => !hasRecentMissedAttack(state, self, candidate),
		);

		const selection = selectAttackTarget(
			availableCandidates,
			partyLeader != null,
		);
		if (selection.target != null) {
			setCombatTarget(state, selection.target.guid);
			target = selection.target;
			const preferredTarget = `${selection.target.guid}${selection.target.weenieId == null ? "" : `:${selection.target.weenieId}`}`;
			logMageInfo(
				`attack target -> ${preferredTarget} (${selection.target.reason}); candidates=${candidates.length}`,
			);
		} else if (candidates.length > 0) {
			if (availableCandidates.length === 0) {
				logMageInfo(
					`combat scan -> ${candidates.length} candidates but all recently missed`,
				);
			}
			logMageInfo(
				`combat scan -> ${candidates.length} candidates but no target selected`,
			);
		}
	}

	if (target != null && isFollowingTarget(self)) {
		logMageInfo(`follow -> combat-target ${target.guid}`);
		HB.stopMovement();
		return;
	}

	if (target != null) {
		if (maybeCastAttackSpell(state, self, data, spells, skills, target)) {
			return;
		}
		return;
	}

	if (partyLeader != null) {
		followPartyLeader(state, self, partyLeader);
	}
}

function describeAttackTarget(target: AttackTarget): string {
	return `${target.guid}${target.weenieId == null ? "" : `:${target.weenieId}`}:${target.reason}`;
}
