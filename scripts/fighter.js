// Autonomous fighter script for the TUI.
// It keeps the character alive, heals nearby allies or self, supports the party,
// and picks fights that stay compatible with party movement.
// When nothing else needs attention, it stays with the party leader.

const DEFAULT_AGGRO_DISTANCE = 15;
const DEFAULT_MAX_PARTY_DISTANCE = 20;
const PARTY_RESUME_FACTOR = 0.9;
const HEALING_DISTANCE = 15;
const MELEE_STALL_TIMEOUT_SECONDS = 3;
const LOW_STAMINA_RATIO = 0.1;
const LOW_HEALTH_RATIO = 0.6;
const HEALING_BUSY_OPERATIONS = new Set(["use", "use_with_target"]);

let aggroDistance = DEFAULT_AGGRO_DISTANCE;
let maxPartyDistance = DEFAULT_MAX_PARTY_DISTANCE;

// Sticky state for debouncing repeated actions across ticks.
const state = {
  wasLowStamina: false,
  lowStaminaCancelIssued: false,
  lastPrimaryActionKey: null,
  preferredAttackTargetGuid: null,
  partySeparationLatched: false,
  meleeStallRecovery: null,
};

function ratio(current, max) {
  return max > 0 ? current / max : 0;
}

function initializeSessionConfig() {
  aggroDistance = DEFAULT_AGGRO_DISTANCE;
  maxPartyDistance = DEFAULT_MAX_PARTY_DISTANCE;
}

function resetTransientState() {
  state.wasLowStamina = false;
  clearTransientState();
}

function clearTransientState() {
  state.lowStaminaCancelIssued = false;
  state.lastPrimaryActionKey = null;
  state.preferredAttackTargetGuid = null;
  state.partySeparationLatched = false;
  state.meleeStallRecovery = null;
}

function parsePositiveNumberArg(args, flagName) {
  const prefix = `${flagName}=`;
  const token = args
    .trim()
    .split(/\s+/)
    .find((candidate) => candidate.startsWith(prefix));
  if (token == null) {
    return null;
  }

  const parsed = Number(token.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function issuePrimaryAction(key, emit) {
  if (state.lastPrimaryActionKey === key) {
    return false;
  }

  state.lastPrimaryActionKey = key;
  emit();
  return true;
}

function toggleCombatMode(on) {
  return issuePrimaryAction(`combat-mode:${on}`, () => {
    HB.setCombatMode(on);
  });
}

function isLowHealth(percent) {
  return percent != null && percent < LOW_HEALTH_RATIO;
}

function isLowStamina(self) {
  return ratio(self.stamina, self.staminaMax) < LOW_STAMINA_RATIO;
}

function isHealingBusy(self) {
  return HEALING_BUSY_OPERATIONS.has(self.busyOperation);
}

function isDefeated(entity) {
  if (entity == null) {
    return false;
  }

  if (entity.motionCommand != null && entity.motionCommand.kind === "dead") {
    return true;
  }

  return (
    entity.profile != null &&
    entity.profile.kind === "creature" &&
    entity.profile.data.health === 0
  );
}

// The leader is the anchor for follow behavior and party distance checks.
function partyLeaderMember(party) {
  if (!party) {
    return null;
  }

  return (
    party.members.find(
      (member) =>
        member.guid === party.leaderGuid && HB.entityExists(member.guid),
    ) ?? null
  );
}

function distanceToPartyLeader(self, partyLeader) {
  return partyLeader ? HB.distance(self.guid, partyLeader.guid) : null;
}

// Pick the most urgent nearby heal target, including self.
function chooseHealingTarget(self) {
  const candidates = [];
  const selfHealthRatio = ratio(self.health, self.healthMax);
  const selfEntity = HB.entity(self.guid);

  if (isLowHealth(selfHealthRatio) && !isDefeated(selfEntity)) {
    candidates.push({
      guid: self.guid,
      distance: 0,
      healthRatio: selfHealthRatio,
    });
  }

  const party = HB.party();
  if (party) {
    for (const member of party.members) {
      if (member.guid === self.guid) {
        continue;
      }

      if (!isLowHealth(member.healthPercent)) {
        continue;
      }

      if (isDefeated(HB.entity(member.guid))) {
        continue;
      }

      const distance = HB.distance(self.guid, member.guid);
      if (distance > HEALING_DISTANCE) {
        continue;
      }

      candidates.push({
        guid: member.guid,
        distance,
        healthRatio: member.healthPercent,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    if (left.healthRatio !== right.healthRatio) {
      return left.healthRatio - right.healthRatio;
    }

    return left.guid - right.guid;
  });

  return candidates[0];
}

// Use the first healing kit we can find.
function firstHealingKit() {
  for (const container of HB.inventory()) {
    for (const itemGuid of container.items) {
      const item = HB.entity(itemGuid);
      if (item && item.kind === "healing_kit") {
        return item.guid;
      }
    }
  }

  return null;
}

// Prefer monsters that keep us close to the party leader.
function selectAttackTarget(self, partyLeader) {
  const monsters = HB.nearbyEntities(aggroDistance, ["monster"]).filter(
    (monster) => !isDefeated(monster),
  );
  const withinPartyAttackRange = (monster) =>
    !partyLeader || HB.distance(partyLeader.guid, monster.guid) <= maxPartyDistance;
  const stickyMonster = state.preferredAttackTargetGuid
    ? monsters.find(
        (monster) =>
          monster.guid === state.preferredAttackTargetGuid &&
          withinPartyAttackRange(monster),
      )
    : null;

  if (stickyMonster) {
    return {
      guid: stickyMonster.guid,
      key: `attack-sticky:${stickyMonster.guid}`,
      reason: "sticky",
    };
  }

  if (state.preferredAttackTargetGuid != null) {
    state.preferredAttackTargetGuid = null;
  }

  if (partyLeader) {
    let bestMonster = null;

    for (const monster of monsters) {
      if (!withinPartyAttackRange(monster)) {
        continue;
      }

      const distanceToParty = HB.distance(partyLeader.guid, monster.guid);

      if (
        bestMonster == null ||
        distanceToParty < bestMonster.distanceToParty ||
        (distanceToParty === bestMonster.distanceToParty &&
          monster.guid < bestMonster.monster.guid)
      ) {
        bestMonster = { monster, distanceToParty };
      }
    }

    if (bestMonster) {
      state.preferredAttackTargetGuid = bestMonster.monster.guid;
      return {
        guid: bestMonster.monster.guid,
        key: `attack-party:${partyLeader.guid}:${bestMonster.monster.guid}`,
        reason: "party-nearest-monster",
      };
    }
  }

  const aggroMonsters = HB.nearbyEntities(aggroDistance, ["monster"]).filter(
    (monster) => !isDefeated(monster),
  );
  if (aggroMonsters.length > 0) {
    const aggroMonster = aggroMonsters.find((monster) =>
      withinPartyAttackRange(monster),
    );
    if (!aggroMonster) {
      return null;
    }

    state.preferredAttackTargetGuid = aggroMonster.guid;
    return {
      guid: aggroMonster.guid,
      key: `attack-aggro:${aggroMonster.guid}`,
      reason: "local-aggro",
    };
  }

  return null;
}

// Suppress repeated heal commands while one is already in flight.
function healIfNeeded(self) {
  const healTarget = chooseHealingTarget(self);
  if (!healTarget) {
    return false;
  }

  if (isHealingBusy(self)) {
    return true;
  }

  const healingKit = firstHealingKit();
  if (healingKit == null) {
    return false;
  }

  const key = `heal:${healingKit}:${healTarget.guid}`;
  return issuePrimaryAction(key, () => {
    HB.useWith(healingKit, healTarget.guid);
  });
}

// Follow only the party leader, never a random nearby member.
function followPartyLeader(self, partyLeader) {
  if (!partyLeader || partyLeader.guid === self.guid) {
    return false;
  }

  const currentInteraction = HB.currentInteraction();
  if (
    currentInteraction != null &&
    currentInteraction.kind === "Follow" &&
    currentInteraction.data.guid === partyLeader.guid
  ) {
    return true;
  }

  const key = `follow:${partyLeader.guid}`;
  return issuePrimaryAction(key, () => {
    HB.cancelInteraction();
    HB.follow(partyLeader.guid);
  });
}

function attackTarget(target, options = {}) {
  if (!target) {
    return false;
  }

  const force = options.force === true;

  const combatInfo = HB.combatInfo();
  const currentInteraction = HB.currentInteraction();
  const alreadyAttackingSameTarget =
    (combatInfo.target != null && combatInfo.target === target.guid) ||
    (currentInteraction != null &&
      currentInteraction.kind === "attack" &&
      currentInteraction.data.guid === target.guid);
  const alreadyApproachingSameTarget =
    currentInteraction != null &&
    currentInteraction.kind === "approach" &&
    currentInteraction.data.guid === target.guid;

  if (!force && alreadyAttackingSameTarget) {
    state.preferredAttackTargetGuid = target.guid;
    return true;
  }

  if (!force && alreadyApproachingSameTarget) {
    state.preferredAttackTargetGuid = target.guid;
    return true;
  }

  state.preferredAttackTargetGuid = target.guid;
  const key = force ? `attack-recover:${target.guid}` : target.key;
  return issuePrimaryAction(key, () => {
    HB.attack(target.guid);
  });
}

function shouldRecoverMeleeStall(combatInfo) {
  if (combatInfo.combatMode !== "Melee" || !combatInfo.isEngaged) {
    return false;
  }

  if (combatInfo.target == null || combatInfo.lastAttackTime == null) {
    return false;
  }

  const serverTime = HB.serverTime();
  if (serverTime <= 0) {
    return false;
  }

  return serverTime - combatInfo.lastAttackTime >= MELEE_STALL_TIMEOUT_SECONDS;
}

function clearMeleeStallRecovery() {
  state.meleeStallRecovery = null;
}

function handleMeleeStallRecovery(combatInfo) {
  if (state.meleeStallRecovery == null) {
    if (!shouldRecoverMeleeStall(combatInfo)) {
      return false;
    }

    state.meleeStallRecovery = {
      phase: "drop",
      targetGuid: combatInfo.target,
    };
  }

  const recovery = state.meleeStallRecovery;
  if (
    recovery == null ||
    combatInfo.target == null ||
    combatInfo.target !== recovery.targetGuid
  ) {
    clearMeleeStallRecovery();
    return false;
  }

  if (recovery.phase === "drop") {
    if (combatInfo.combatMode !== "NonCombat") {
      return toggleCombatMode(false);
    }

    recovery.phase = "raise";
    return true;
  }

  if (recovery.phase === "raise") {
    if (combatInfo.combatMode !== "Melee") {
      return toggleCombatMode(true);
    }

    const attacked = attackTarget(
      {
        guid: recovery.targetGuid,
        key: `attack-recover:${recovery.targetGuid}`,
        reason: "melee-stall-recovery",
      },
      { force: true },
    );

    if (attacked) {
      clearMeleeStallRecovery();
    }

    return attacked;
  }

  clearMeleeStallRecovery();
  return false;
}

// Once separated, stay latched until we are safely back in range of the leader.
function updatePartySeparationLatch(self, partyLeader) {
  if (!partyLeader) {
    state.partySeparationLatched = false;
    return { shouldFollow: false, distance: null };
  }

  const distance = distanceToPartyLeader(self, partyLeader);
  const isSeparated = distance != null && distance > maxPartyDistance;

  if (isSeparated) {
    state.partySeparationLatched = true;
    state.preferredAttackTargetGuid = null;
    return { shouldFollow: true, distance };
  }

  if (
    state.partySeparationLatched &&
    (distance == null || distance <= maxPartyDistance * PARTY_RESUME_FACTOR)
  ) {
    state.partySeparationLatched = false;
  }

  return { shouldFollow: state.partySeparationLatched, distance };
}

// Main priority loop for each lifecycle tick.
function runFighter() {
  const self = HB.selfEntity();
  if (!self) {
    return;
  }

  const combatInfo = HB.combatInfo();
  const lowStamina = isLowStamina(self);

  if (lowStamina) {
    if (!state.wasLowStamina) {
      HB.say("I'm tired");
      state.wasLowStamina = true;
    }

    let emittedAction = false;

    if (combatInfo.isEngaged && !state.lowStaminaCancelIssued) {
      state.lowStaminaCancelIssued = true;
      emittedAction = issuePrimaryAction("low-stamina-cancel", () => {
        HB.cancelInteraction();
      });
    }

    if (healIfNeeded(self)) {
      return;
    }

    if (!emittedAction) {
      state.lastPrimaryActionKey = "low-stamina";
    }

    return;
  }

  state.wasLowStamina = false;
  state.lowStaminaCancelIssued = false;

  if (self.busyOperation !== "none") {
    return;
  }

  if (healIfNeeded(self)) {
    return;
  }

  if (handleMeleeStallRecovery(combatInfo)) {
    return;
  }

  const party = HB.party();
  const partyLeader = partyLeaderMember(party);
  const separation = updatePartySeparationLatch(self, partyLeader);

  if (separation.shouldFollow) {
    if (partyLeader) {
      followPartyLeader(self, partyLeader);
      return;
    }

    state.partySeparationLatched = false;
  }

  const combatTarget =
    combatInfo.target != null ? HB.entity(combatInfo.target) : null;
  const combatTargetDefeated = isDefeated(combatTarget);

  if (combatInfo.isEngaged && !combatTargetDefeated) {
    return;
  }

  if (combatInfo.isEngaged && combatTargetDefeated) {
    state.preferredAttackTargetGuid = null;
    HB.cancelInteraction();
  }

  if (attackTarget(selectAttackTarget(self, partyLeader))) {
    return;
  }

  followPartyLeader(self, partyLeader);
}

HB.onEvent((event) => {
  if (event.kind !== "lifecycle") {
    return;
  }

  switch (event.data.kind) {
    case "started":
      resetTransientState();
      initializeSessionConfig();
      aggroDistance =
        parsePositiveNumberArg(event.data.data.args, "aggro-dist") ??
        DEFAULT_AGGRO_DISTANCE;
      maxPartyDistance =
        parsePositiveNumberArg(event.data.data.args, "max-party-dist") ??
        DEFAULT_MAX_PARTY_DISTANCE;
      runFighter();
      break;
    case "teleport_started":
      clearTransientState();
      break;
    case "stopped":
      resetTransientState();
      break;
    case "tick":
      runFighter();
      break;
  }
});
