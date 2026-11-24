// Autonomous fighter script using the unified Holtburger Live API (`HB`).
// Keeps the character alive, heals nearby allies or self, supports the party,
// and picks fights that stay compatible with party movement.
// When nothing else needs attention, it follows the party leader.

const DEFAULT_AGGRO_DISTANCE = 15;
const DEFAULT_MAX_PARTY_DISTANCE = 20;
const PARTY_RESUME_FACTOR = 0.9;
const HEALING_DISTANCE = 15;
const LOW_STAMINA_RATIO = 0.1;
const LOW_HEALTH_RATIO = 0.6;
const HEALING_BUSY_OPERATIONS = new Set(["use", "use-with-target"]);
const DEFAULT_MELEE_PROFILE = { kind: "melee", height: "medium", power: 0.5 };

let aggroDistance = DEFAULT_AGGRO_DISTANCE;
let maxPartyDistance = DEFAULT_MAX_PARTY_DISTANCE;

// Sticky state for debouncing repeated actions across ticks.
const state = {
  wasLowStamina: false,
  lowStaminaCancelIssued: false,
  lastPrimaryActionKey: null,
  preferredAttackTargetGuid: null,
  partySeparationLatched: false,
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
}

function parsePositiveNumberArg(args, flagName) {
  const prefix = `${flagName}=`;
  const token = String(args ?? "")
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

function isLowHealth(percent) {
  return percent != null && percent < LOW_HEALTH_RATIO;
}

function isLowStamina(self) {
  return ratio(self.stamina, self.staminaMax) < LOW_STAMINA_RATIO;
}

function isHealingBusy(self) {
  return self.busy != null && HEALING_BUSY_OPERATIONS.has(self.busy);
}

function entitySummary(entityOrDetail) {
  if (entityOrDetail == null) {
    return null;
  }
  return "summary" in entityOrDetail ? entityOrDetail.summary : entityOrDetail;
}

function isDefeated(entityOrDetail) {
  const summary = entitySummary(entityOrDetail);
  if (summary == null) {
    return false;
  }
  return Boolean(summary.isDead);
}

// Automated combat stays PvE-only, using world-owned hostility and observed life.
function isAttackCandidate(entityOrDetail) {
  const summary = entitySummary(entityOrDetail);
  return (
    summary != null &&
    summary.category === "monster" &&
    summary.isHostile &&
    !summary.isDead
  );
}

function getFellowship() {
  const social = HB.social();
  return social?.fellowship ?? null;
}

function memberHealthRatio(member) {
  if (member == null || !member.max_health) {
    return null;
  }
  return ratio(member.current_health, member.max_health);
}

// The leader is the anchor for follow behavior and party distance checks.
function partyLeaderMember(fellowship) {
  if (!fellowship || fellowship.leader_guid == null) {
    return null;
  }

  return (
    fellowship.members.find(
      (member) =>
        member.guid === fellowship.leader_guid && HB.entity(member.guid) != null,
    ) ?? null
  );
}

function distanceToPartyLeader(self, partyLeader) {
  return partyLeader ? HB.distance(self.guid, partyLeader.guid) : null;
}

function isFollowingTarget(self, targetGuid) {
  return (
    self.navigation?.goal?.kind === "follow" &&
    self.navigation.goal.target === targetGuid
  );
}

function cancelActiveActions() {
  HB.stopCombat();
  HB.stopMovement();
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

  const fellowship = getFellowship();
  if (fellowship) {
    for (const member of fellowship.members) {
      if (member.guid === self.guid) {
        continue;
      }

      const healthRatio = memberHealthRatio(member);
      if (!isLowHealth(healthRatio)) {
        continue;
      }

      if (isDefeated(HB.entity(member.guid))) {
        continue;
      }

      const distance = HB.distance(self.guid, member.guid);
      if (!Number.isFinite(distance) || distance > HEALING_DISTANCE) {
        continue;
      }

      candidates.push({
        guid: member.guid,
        distance,
        healthRatio,
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
  const inventory = HB.inventory();
  if (!inventory || !Array.isArray(inventory.containers)) {
    return null;
  }

  for (const container of inventory.containers) {
    for (const itemGuid of container.items) {
      const item = entitySummary(HB.entity(itemGuid));
      if (item && item.category === "healing_kit") {
        return item.guid;
      }
    }
  }

  return null;
}

// Prefer monsters that keep us close to the party leader.
function selectAttackTarget(self, partyLeader) {
  const monsters = HB.entities({
    maxDistance: aggroDistance,
    category: "monster",
  }).filter(isAttackCandidate);
  const withinPartyAttackRange = (monster) =>
    !partyLeader ||
    HB.distance(partyLeader.guid, monster.guid) <= maxPartyDistance;
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

  if (monsters.length > 0) {
    const aggroMonster = monsters.find(withinPartyAttackRange);
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
    HB.useItem(healingKit, healTarget.guid);
  });
}

// Follow only the party leader, never a random nearby member.
function followPartyLeader(self, partyLeader) {
  if (!partyLeader || partyLeader.guid === self.guid) {
    return false;
  }

  if (isFollowingTarget(self, partyLeader.guid)) {
    return true;
  }

  const key = `follow:${partyLeader.guid}`;
  return issuePrimaryAction(key, () => {
    HB.stopCombat();
    HB.follow(partyLeader.guid);
  });
}

function attackTarget(self, target) {
  if (!target) {
    return false;
  }

  const combat = HB.combat();
  const alreadyAttackingSameTarget =
    combat.target != null && combat.target === target.guid;
  const alreadyApproachingSameTarget =
    self.navigation?.goal?.kind === "approach" &&
    self.navigation.goal.target === target.guid;

  if (alreadyAttackingSameTarget || alreadyApproachingSameTarget) {
    state.preferredAttackTargetGuid = target.guid;
    return true;
  }

  state.preferredAttackTargetGuid = target.guid;
  return issuePrimaryAction(target.key, () => {
    HB.beginCombat(target.guid, DEFAULT_MELEE_PROFILE);
  });
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
  const self = HB.self();
  if (!self || !self.guid) {
    return;
  }

  const combat = HB.combat();
  const isEngaged = combat.state !== "idle" && combat.target != null;
  // Retire invalid engagements before any other automation can retain their target.
  if (isEngaged && !isAttackCandidate(HB.entity(combat.target))) {
    state.preferredAttackTargetGuid = null;
    issuePrimaryAction(`invalid-target:${combat.target}`, cancelActiveActions);
    return;
  }
  const lowStamina = isLowStamina(self);

  if (lowStamina) {
    if (!state.wasLowStamina) {
      HB.say("I'm tired");
      state.wasLowStamina = true;
    }

    let emittedAction = false;

    if (isEngaged && !state.lowStaminaCancelIssued) {
      state.lowStaminaCancelIssued = true;
      emittedAction = issuePrimaryAction(
        "low-stamina-cancel",
        cancelActiveActions,
      );
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

  if (self.busy != null) {
    return;
  }

  if (healIfNeeded(self)) {
    return;
  }

  const fellowship = getFellowship();
  const partyLeader = partyLeaderMember(fellowship);
  const separation = updatePartySeparationLatch(self, partyLeader);

  if (separation.shouldFollow) {
    if (partyLeader) {
      followPartyLeader(self, partyLeader);
      return;
    }

    state.partySeparationLatched = false;
  }

  if (isEngaged) {
    return;
  }

  if (attackTarget(self, selectAttackTarget(self, partyLeader))) {
    return;
  }

  followPartyLeader(self, partyLeader);
}

HB.onEvent((event) => {
  switch (event.kind) {
    case "started":
      resetTransientState();
      initializeSessionConfig();
      aggroDistance =
        parsePositiveNumberArg(event.args, "aggro-dist") ??
        DEFAULT_AGGRO_DISTANCE;
      maxPartyDistance =
        parsePositiveNumberArg(event.args, "max-party-dist") ??
        DEFAULT_MAX_PARTY_DISTANCE;
      runFighter();
      break;
    case "stopped":
      resetTransientState();
      break;
    case "tick":
      runFighter();
      break;
    case "api":
      if (event.event?.kind === "teleport-started") {
        clearTransientState();
      }
      break;
  }
});
