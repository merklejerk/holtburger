"use strict";
(() => {
  // src/constants.ts
  var MAX_AGGRO_DISTANCE = 25;
  var MAX_PARTY_DISTANCE = 10;
  var PARTY_RESUME_FACTOR = 0.9;
  var HEALING_DISTANCE = 15;
  var SELF_MANA_THRESHOLD = 0.4;
  var SELF_HEALTH_THRESHOLD = 0.6;
  var SELF_STAMINA_THRESHOLD = 0.6;
  var PARTY_HEAL_THRESHOLD = 0.6;
  var PARTY_REVITALIZE_THRESHOLD = 0.4;
  var SPELL_SKILL_HEADROOM = 30;
  var SPELL_REPEAT_SECONDS = 1.1;
  var HEALING_KIT_SUCCESS_GRACE_SECONDS = 2;
  var PENDING_SPELL_BUSY_GRACE_SECONDS = 1;
  var VULN_REPEAT_SECONDS = 10 * 60;
  var MAX_VULN_ATTEMPTS_PER_TARGET = 2;
  var FOLLOW_REPEAT_SECONDS = 1.5;
  var PENDING_SPELL_TIMEOUT_SECONDS = 8;
  var ATTACK_SPELL_TIMEOUT_SECONDS = 5;
  var EMPTY_DAMAGE_TYPES = [];

  // src/skills.ts
  function isSkillUsable(skill) {
    return skill != null && skill.training !== "Unusable" && skill.training !== "Untrained";
  }
  function currentSkills(data) {
    const sheet = HB.characterSheet();
    const skills = /* @__PURE__ */ new Map();
    if (sheet == null) {
      return skills;
    }
    for (const [debugId, skillId] of Object.entries(data.skills)) {
      const skill = sheet.skills.find(
        (entry) => entry.skillType === skillTypeFromId(skillId)
      );
      if (!skill) {
        continue;
      }
      skills.set(debugId, {
        skillId,
        effective: skill.effective,
        training: skill.training
      });
    }
    return skills;
  }
  function currentSpellbook() {
    return new Set(HB.spellbook().map((spellId) => spellId & 2147483647));
  }
  function skillTypeFromId(skillId) {
    switch (skillId) {
      case 21:
        return "Healing";
      case 33:
        return "LifeMagic";
      case 34:
        return "WarMagic";
      case 43:
        return "VoidMagic";
      default:
        throw new Error(`unsupported mage skill id ${skillId}`);
    }
  }

  // src/domain/spells.ts
  var DAMAGE_TYPES_BY_PREFERENCE = [
    "acid",
    "bludgeon",
    "cold",
    "direct",
    "fire",
    "lightning",
    "pierce",
    "slash",
    "void"
  ];
  function availableSpells(data, spellbook, skills) {
    return Object.values(data.spells).filter((spell) => {
      if (!spellbook.has(spell.spellId)) {
        return false;
      }
      const skill = skills.get(spell.school);
      if (skill == null || !isSkillUsable(skill)) {
        return false;
      }
      return skill.effective >= spell.difficulty + SPELL_SKILL_HEADROOM;
    });
  }
  function canTargetSpell(spell, targetGuid, selfGuid) {
    if (spell.targetKind === "self") {
      return targetGuid == null || targetGuid === selfGuid;
    }
    return targetGuid != null && targetGuid !== selfGuid;
  }
  function spellInRange(spell, selfGuid, targetGuid, distanceBetween) {
    if (targetGuid == null || spell.range == null) {
      return true;
    }
    return distanceBetween(selfGuid, targetGuid) <= spell.range;
  }
  function chooseBestSpell(spells, options, distanceBetween) {
    const preferredDamageTypes = options.preferredDamageTypes ?? EMPTY_DAMAGE_TYPES;
    const preferredSpellIds = options.preferredSpellIds ?? [];
    const candidates = spells.filter((spell) => {
      if (options.school != null && spell.school !== options.school) {
        return false;
      }
      if (options.type != null && spell.type !== options.type) {
        return false;
      }
      if (options.targetKind != null && spell.targetKind !== options.targetKind) {
        return false;
      }
      if (options.exactDamageType != null && spell.damageType !== options.exactDamageType) {
        return false;
      }
      if (!canTargetSpell(spell, options.targetGuid ?? null, options.selfGuid)) {
        return false;
      }
      return spellInRange(
        spell,
        options.selfGuid,
        options.targetGuid ?? null,
        distanceBetween
      );
    });
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((left, right) => {
      const leftPreferred = preferredDamageTypeIndex(
        preferredDamageTypes,
        left.damageType
      );
      const rightPreferred = preferredDamageTypeIndex(
        preferredDamageTypes,
        right.damageType
      );
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      if (left.difficulty !== right.difficulty) {
        return right.difficulty - left.difficulty;
      }
      const leftPreferredSpell = preferredSpellIdIndex(
        preferredSpellIds,
        left.spellId
      );
      const rightPreferredSpell = preferredSpellIdIndex(
        preferredSpellIds,
        right.spellId
      );
      if (leftPreferredSpell !== rightPreferredSpell) {
        return leftPreferredSpell - rightPreferredSpell;
      }
      return left.spellId - right.spellId;
    });
    return candidates[0] ?? null;
  }
  function preferredDamageTypesForWeenie(data, weenieId) {
    if (weenieId == null) {
      return EMPTY_DAMAGE_TYPES;
    }
    const resistWord = findResistWord(data.weenieResists, weenieId);
    if (resistWord == null) {
      return EMPTY_DAMAGE_TYPES;
    }
    return [...DAMAGE_TYPES_BY_PREFERENCE].sort((left, right) => {
      const leftScore = resistScoreForDamageType(resistWord, left);
      const rightScore = resistScoreForDamageType(resistWord, right);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return DAMAGE_TYPES_BY_PREFERENCE.indexOf(left) - DAMAGE_TYPES_BY_PREFERENCE.indexOf(right);
    });
  }
  function knownAttackSpells(spells, school) {
    return spells.filter(
      (spell) => spell.school === school && spell.type === "attack"
    );
  }
  function maxSpellRange(spells) {
    const ranged = spells.map((spell) => spell.range).filter((range) => range != null);
    if (ranged.length === 0) {
      return null;
    }
    return Math.max(...ranged);
  }
  function preferredDamageTypeIndex(preferredDamageTypes, damageType) {
    if (damageType == null) {
      return Number.POSITIVE_INFINITY;
    }
    const index = preferredDamageTypes.indexOf(damageType);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }
  function preferredSpellIdIndex(preferredSpellIds, spellId) {
    const index = preferredSpellIds.indexOf(spellId);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }
  function findResistWord(weenieResists, weenieId) {
    if (weenieResists.byteLength < 8) {
      return null;
    }
    const view = new DataView(
      weenieResists.buffer,
      weenieResists.byteOffset,
      weenieResists.byteLength
    );
    let low = 0;
    let high = Math.floor(view.byteLength / 8) - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const word = view.getBigUint64(mid * 8, true);
      const recordWeenieId = Number(word & 0xffffffn);
      if (recordWeenieId === weenieId) {
        return word;
      }
      if (recordWeenieId < weenieId) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return null;
  }
  function resistScoreForDamageType(word, damageType) {
    switch (damageType) {
      case "pierce":
        return Number(word >> 24n & 0xfn);
      case "bludgeon":
        return Number(word >> 28n & 0xfn);
      case "slash":
        return Number(word >> 32n & 0xfn);
      case "acid":
        return Number(word >> 36n & 0xfn);
      case "cold":
        return Number(word >> 40n & 0xfn);
      case "fire":
        return Number(word >> 44n & 0xfn);
      case "lightning":
        return Number(word >> 48n & 0xfn);
      case "void":
        return Number(word >> 52n & 0xfn);
      case "direct":
        return 15;
    }
    return 15;
  }

  // src/domain/targeting.ts
  function isMonsterCandidateInCombatRange(candidate, maxAttackRange, maxAggroDistance) {
    return candidate.distanceToSelf <= Math.min(maxAggroDistance, maxAttackRange);
  }
  function updatePartySeparation(currentLatched, distanceToLeader, maxPartyDistance = MAX_PARTY_DISTANCE) {
    const partyResumeDistance = maxPartyDistance * PARTY_RESUME_FACTOR;
    if (distanceToLeader == null) {
      return {
        shouldFollow: false,
        distance: null,
        nextLatched: false
      };
    }
    if (distanceToLeader > maxPartyDistance) {
      return {
        shouldFollow: true,
        distance: distanceToLeader,
        nextLatched: true
      };
    }
    if (currentLatched && distanceToLeader <= partyResumeDistance) {
      return {
        shouldFollow: false,
        distance: distanceToLeader,
        nextLatched: false
      };
    }
    return {
      shouldFollow: currentLatched,
      distance: distanceToLeader,
      nextLatched: currentLatched
    };
  }
  function selectAttackTarget(candidates, hasPartyLeader) {
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
        target: null
      };
    }
    return {
      nextCombatTargetGuid: chosen.guid,
      target: {
        guid: chosen.guid,
        reason: hasPartyLeader ? "party-nearest-monster" : "nearest-monster",
        weenieId: chosen.weenieId
      }
    };
  }

  // src/runtime-helpers.ts
  function ratio(current, max) {
    return max > 0 ? current / max : 0;
  }
  function isDefeated(entity) {
    if (entity == null) {
      return false;
    }
    if (entity.motionCommand.kind === "dead") {
      return true;
    }
    return entity.profile?.kind === "creature" && entity.profile.data.health === 0;
  }

  // src/party.ts
  function partyLeaderMember(party) {
    if (party == null) {
      return null;
    }
    return party.members.find(
      (member) => member.guid === party.leaderGuid && HB.entityExists(member.guid)
    ) ?? null;
  }
  function choosePartyHealTarget(self) {
    return choosePartyMemberBelowThreshold(
      self,
      PARTY_HEAL_THRESHOLD,
      (member) => member.healthPercent
    );
  }
  function choosePartyRevitalizeTarget(self) {
    return choosePartyMemberBelowThreshold(
      self,
      PARTY_REVITALIZE_THRESHOLD,
      (member) => member.staminaPercent
    );
  }
  function choosePartyMemberBelowThreshold(self, threshold, percentForMember) {
    const party = HB.party();
    if (!party) {
      return null;
    }
    const candidates = [];
    for (const member of party.members) {
      if (member.guid === self.guid) {
        continue;
      }
      const percent = percentForMember(member);
      if (percent == null || percent >= threshold) {
        continue;
      }
      const distance = HB.distance(self.guid, member.guid);
      if (distance > HEALING_DISTANCE) {
        continue;
      }
      if (isDefeated(HB.entity(member.guid))) {
        continue;
      }
      candidates.push({
        guid: member.guid,
        percent,
        distance
      });
    }
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((left, right) => {
      if (left.percent !== right.percent) {
        return left.percent - right.percent;
      }
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.guid - right.guid;
    });
    return candidates[0]?.guid ?? null;
  }

  // src/runtime-actions.ts
  function logMageInfo(message) {
    HB.debugLog(`mage: ${message}`);
  }
  function issueAction(state2, key, minIntervalSeconds, action) {
    const lastIssuedAt = state2.actionTimes.get(key);
    if (lastIssuedAt != null && state2.elapsedSeconds - lastIssuedAt < minIntervalSeconds) {
      return false;
    }
    state2.actionTimes.set(key, state2.elapsedSeconds);
    action();
    return true;
  }
  function castSpell(state2, spell, targetGuid) {
    if (spellcastBlocksPlanning(state2)) {
      return false;
    }
    const actionKey = `cast:${spell.spellId}:${targetGuid ?? "self"}`;
    return issueAction(state2, actionKey, SPELL_REPEAT_SECONDS, () => {
      const request = createSpellcastRequest(state2, spell, targetGuid);
      state2.spellcast = {
        phase: "awaiting_busy",
        request
      };
      logMageInfo(
        `cast start -> ${describeSpellcastRequest(request)} at ${state2.elapsedSeconds.toFixed(2)}s`
      );
      HB.castSpell(spell.spellId, targetGuid);
    });
  }
  function currentSpellcastRequest(state2) {
    return state2.spellcast.phase === "idle" ? null : state2.spellcast.request;
  }
  function spellcastBlocksPlanning(state2) {
    return state2.spellcast.phase !== "idle";
  }
  function resolveSpellcastFromChatMessage(state2, chatEvent, targetName) {
    const request = currentSpellcastRequest(state2);
    if (request == null) {
      return false;
    }
    const expectedTargetName = request.targetName ?? targetName;
    if (request.kind === "vulnerability") {
      if (isResistMessage(chatEvent, expectedTargetName)) {
        return finalizeSpellcast(state2, { kind: "resisted" }) != null;
      }
      if (isVulnerabilityLandingMessage(request, chatEvent, expectedTargetName)) {
        return finalizeSpellcast(state2, { kind: "succeeded" }) != null;
      }
      return false;
    }
    if (request.kind === "attack") {
      if (isResistMessage(chatEvent, expectedTargetName)) {
        return finalizeSpellcast(state2, { kind: "resisted" }) != null;
      }
      if (isAttackBlockedMessage(chatEvent, expectedTargetName)) {
        return finalizeSpellcast(state2, { kind: "fizzled" }) != null;
      }
      if (isAttackLandingMessage(request, chatEvent, expectedTargetName)) {
        return finalizeSpellcast(state2, { kind: "succeeded" }) != null;
      }
      return false;
    }
    return false;
  }
  function resolveSpellcastFromCombatFeedback(state2, feedback) {
    const request = currentSpellcastRequest(state2);
    if (request == null || request.kind !== "attack") {
      return false;
    }
    switch (feedback.kind) {
      case "victim_notification":
      case "killer_notification":
        return finalizeSpellcast(state2, { kind: "succeeded" }) != null;
      case "attack_done":
        return feedback.data.error !== "None" ? resolveSpellcastFromWeenieError(state2) : false;
      case "attack_commenced":
      case "attacker_notification":
      case "defender_notification":
      case "evasion_attacker_notification":
      case "evasion_defender_notification":
        return false;
    }
  }
  function observeSpellCastBusy(state2) {
    if (state2.spellcast.phase !== "awaiting_busy") {
      return;
    }
    state2.spellcast = {
      phase: "active",
      request: state2.spellcast.request,
      busySince: state2.elapsedSeconds
    };
    logMageInfo(
      `cast busy -> ${describeSpellcastRequest(state2.spellcast.request)} at ${state2.elapsedSeconds.toFixed(2)}s`
    );
  }
  function resolveSpellcastFromIdle(state2) {
    if (state2.spellcast.phase === "idle") {
      return false;
    }
    if (state2.spellcast.phase === "awaiting_busy") {
      const pendingAge = state2.elapsedSeconds - state2.spellcast.request.issuedAt;
      if (pendingAge < PENDING_SPELL_BUSY_GRACE_SECONDS) {
        return false;
      }
      return finalizeSpellcast(state2, { kind: "fizzled" }) != null;
    }
    if (state2.spellcast.request.kind === "attack" || state2.spellcast.request.kind === "vulnerability") {
      return false;
    }
    return finalizeSpellcast(state2, { kind: "succeeded" }) != null;
  }
  function resolveSpellcastFromTimeout(state2) {
    const request = currentSpellcastRequest(state2);
    if (request == null) {
      return false;
    }
    const timeoutSeconds = request.kind === "attack" ? ATTACK_SPELL_TIMEOUT_SECONDS : PENDING_SPELL_TIMEOUT_SECONDS;
    if (state2.elapsedSeconds - request.issuedAt < timeoutSeconds) {
      return false;
    }
    return finalizeSpellcast(
      state2,
      request.kind === "attack" ? { kind: "missed" } : { kind: "timed_out" }
    ) != null;
  }
  function resolveSpellcastFromWeenieError(state2) {
    return interruptSpellcast(state2, "weenie_error");
  }
  function interruptSpellcast(state2, reason) {
    return finalizeSpellcast(state2, {
      kind: "interrupted",
      reason
    }) != null;
  }
  function cancelCombatPlanning(state2) {
    const hadSpellcast = spellcastBlocksPlanning(state2);
    const hadHealingKitUse = healingKitUseBlocksPlanning(state2);
    const hadCombatTarget = state2.combatTargetGuid != null;
    const hadMissHistory = state2.attackPolicy.lastMissedAttackByTarget.size > 0;
    if (hadSpellcast) {
      interruptSpellcast(state2, "teleport");
    }
    if (hadHealingKitUse) {
      clearHealingKitUse(state2);
    }
    clearCombatTarget(state2);
    state2.attackPolicy.lastMissedAttackByTarget.clear();
    return hadSpellcast || hadHealingKitUse || hadCombatTarget || hadMissHistory;
  }
  function hasRecentVulnerabilityCast(state2, targetGuid) {
    const lastAppliedAt = state2.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.get(targetGuid);
    return lastAppliedAt != null && state2.elapsedSeconds - lastAppliedAt < VULN_REPEAT_SECONDS;
  }
  function failedVulnAttemptCount(state2, targetGuid) {
    return state2.vulnerabilityPolicy.failedVulnAttemptsByTarget.get(targetGuid) ?? 0;
  }
  function hasRecentMissedAttack(state2, self, target) {
    const record = state2.attackPolicy.lastMissedAttackByTarget.get(target.guid);
    if (record == null) {
      return false;
    }
    if (state2.elapsedSeconds - record.missedAt >= PENDING_SPELL_TIMEOUT_SECONDS) {
      return false;
    }
    const currentRay = createAttackRaySnapshot(self.position, target.position);
    if (currentRay == null) {
      return false;
    }
    return isSimilarAttackRay(record.ray, currentRay);
  }
  function vulnerabilityPolicyForTarget(state2, targetGuid) {
    return {
      failedVulnAttemptCount: failedVulnAttemptCount(state2, targetGuid),
      recentlySucceeded: hasRecentVulnerabilityCast(state2, targetGuid)
    };
  }
  function clearHealingKitHistory(state2, targetGuid) {
    if (state2.healingKitPolicy.pendingUse?.targetGuid === targetGuid) {
      clearHealingKitUse(state2);
    }
    state2.healingKitPolicy.lastSuccessfulUseAtByTarget.delete(targetGuid);
  }
  function hasRecentHealingKitSuccess(state2, targetGuid) {
    const lastAppliedAt = state2.healingKitPolicy.lastSuccessfulUseAtByTarget.get(targetGuid);
    return lastAppliedAt != null && state2.elapsedSeconds - lastAppliedAt < HEALING_KIT_SUCCESS_GRACE_SECONDS;
  }
  function clearVulnerabilityAttemptHistory(state2, targetGuid) {
    state2.vulnerabilityPolicy.failedVulnAttemptsByTarget.delete(targetGuid);
  }
  function clearAttackHistory(state2, targetGuid) {
    state2.attackPolicy.lastMissedAttackByTarget.delete(targetGuid);
  }
  function clearCombatTarget(state2) {
    state2.combatTargetGuid = null;
  }
  function setCombatTarget(state2, targetGuid) {
    state2.combatTargetGuid = targetGuid;
  }
  function isCombatTargetAlive(entity) {
    return entity != null && entity.motionCommand.kind !== "dead";
  }
  function resolveCombatTarget(state2, self, partyLeader, maxAttackRange) {
    const combatTargetGuid = state2.combatTargetGuid;
    if (combatTargetGuid == null) {
      return null;
    }
    if (!HB.entityExists(combatTargetGuid)) {
      clearCombatTarget(state2);
      return null;
    }
    const entity = HB.entity(combatTargetGuid);
    if (entity == null) {
      clearCombatTarget(state2);
      return null;
    }
    if (!isCombatTargetAlive(entity)) {
      clearCombatTarget(state2);
      return null;
    }
    const candidate = {
      guid: entity.guid,
      weenieId: entity.weenieId,
      position: entity.position,
      distanceToSelf: HB.distance(self.guid, entity.guid),
      distanceToParty: partyLeader != null ? HB.distance(partyLeader.guid, entity.guid) : 0
    };
    if (!isMonsterCandidateInCombatRange(
      candidate,
      maxAttackRange,
      state2.maxAggroDistance
    )) {
      clearCombatTarget(state2);
      return null;
    }
    return entity;
  }
  function followPartyLeader(state2, self, partyLeader) {
    const currentInteraction = HB.currentInteraction();
    if (partyLeader == null) {
      if (currentInteraction?.kind === "Follow") {
        HB.cancelInteraction();
      }
      return false;
    }
    if (partyLeader.guid === self.guid) {
      if (currentInteraction?.kind === "Follow" && currentInteraction.data.guid !== partyLeader.guid) {
        HB.cancelInteraction();
      }
      return false;
    }
    if (currentInteraction?.kind === "Follow" && currentInteraction.data.guid === partyLeader.guid) {
      return true;
    }
    return issueAction(
      state2,
      `follow:${partyLeader.guid}`,
      FOLLOW_REPEAT_SECONDS,
      () => {
        logMageInfo(`follow -> ${partyLeader.guid}`);
        if (currentInteraction != null) {
          HB.cancelInteraction();
        }
        HB.follow(partyLeader.guid);
      }
    );
  }
  function firstHealingKit() {
    for (const container of HB.inventory()) {
      for (const itemGuid of container.items) {
        const item = HB.entity(itemGuid);
        if (item?.kind === "healing_kit") {
          return item.guid;
        }
      }
    }
    return null;
  }
  function useHealingKitOnTarget(state2, targetGuid) {
    if (healingKitUseBlocksPlanning(state2)) {
      return false;
    }
    if (hasRecentHealingKitSuccess(state2, targetGuid)) {
      return false;
    }
    const kitGuid = firstHealingKit();
    if (kitGuid == null) {
      return false;
    }
    const target = HB.entity(targetGuid);
    state2.healingKitPolicy.pendingUse = {
      targetGuid,
      targetName: normalizeCastName(target?.name?.trim() ?? null),
      kitGuid,
      issuedAt: state2.elapsedSeconds
    };
    logMageInfo(
      `heal-kit start -> ${describeHealingKitUse(state2.healingKitPolicy.pendingUse)} at ${state2.elapsedSeconds.toFixed(2)}s`
    );
    HB.useWith(kitGuid, targetGuid);
    return true;
  }
  function healingKitUseBlocksPlanning(state2) {
    return state2.healingKitPolicy.pendingUse != null;
  }
  function resolveHealingKitUseFromChatMessage(state2, chatEvent, targetName) {
    const request = state2.healingKitPolicy.pendingUse;
    if (request == null) {
      return false;
    }
    const expectedTargetName = request.targetName ?? targetName;
    if (expectedTargetName == null) {
      return false;
    }
    if (isHealingKitFailureMessage(chatEvent, expectedTargetName)) {
      clearHealingKitUse(state2);
      logMageInfo(
        `heal-kit failed -> ${describeHealingKitUse(request)} at ${state2.elapsedSeconds.toFixed(2)}s`
      );
      return true;
    }
    if (isHealingKitSuccessMessage(chatEvent, expectedTargetName)) {
      state2.healingKitPolicy.lastSuccessfulUseAtByTarget.set(
        request.targetGuid,
        state2.elapsedSeconds
      );
      clearHealingKitUse(state2);
      logMageInfo(
        `heal-kit succeeded -> ${describeHealingKitUse(request)} at ${state2.elapsedSeconds.toFixed(2)}s`
      );
      return true;
    }
    return false;
  }
  function resolveHealingKitUseFromTimeout(state2) {
    const request = state2.healingKitPolicy.pendingUse;
    if (request == null) {
      return false;
    }
    if (state2.elapsedSeconds - request.issuedAt < PENDING_SPELL_TIMEOUT_SECONDS) {
      return false;
    }
    clearHealingKitUse(state2);
    logMageInfo(
      `heal-kit timeout -> ${describeHealingKitUse(request)} at ${state2.elapsedSeconds.toFixed(2)}s`
    );
    return true;
  }
  function clearNonMageInteraction(state2) {
    const interaction = HB.currentInteraction();
    if (interaction?.kind !== "Attack" && interaction?.kind !== "Approach") {
      return false;
    }
    return issueAction(
      state2,
      `cancel:${interaction.kind}:${interaction.data.guid}`,
      0.5,
      () => {
        HB.cancelInteraction();
      }
    );
  }
  function createSpellcastRequest(state2, spell, targetGuid) {
    const self = HB.selfEntity();
    const target = targetGuid == null ? null : HB.entity(targetGuid);
    const targetName = normalizeCastName(target?.name?.trim() ?? null);
    return {
      spellName: normalizeCastName(spell.name ?? null),
      targetName,
      spellId: spell.spellId,
      targetGuid,
      damageType: spell.damageType,
      kind: spellcastKindForSpell(spell),
      issuedAt: state2.elapsedSeconds,
      attackRay: spell.type === "attack" && self != null && target != null ? createAttackRaySnapshot(self.position, target.position) : null
    };
  }
  function spellcastKindForSpell(spell) {
    switch (spell.type) {
      case "attack":
        return "attack";
      case "vuln":
        return "vulnerability";
      case "heal":
        return "heal";
      case "revitalize":
        return "revitalize";
      default:
        return "transfer";
    }
  }
  function finalizeSpellcast(state2, outcome) {
    const request = currentSpellcastRequest(state2);
    if (request == null) {
      return null;
    }
    const resolution = {
      request,
      outcome,
      resolvedAt: state2.elapsedSeconds
    };
    applyAttackOutcome(state2, resolution);
    applyVulnerabilityOutcome(state2, resolution);
    logSpellcastResolution(state2, resolution);
    state2.spellcast = { phase: "idle" };
    return resolution;
  }
  function applyAttackOutcome(state2, resolution) {
    const targetGuid = resolution.request.targetGuid;
    if (resolution.request.kind !== "attack" || targetGuid == null) {
      return;
    }
    if (resolution.outcome.kind === "missed") {
      if (resolution.request.attackRay != null) {
        state2.attackPolicy.lastMissedAttackByTarget.set(targetGuid, {
          missedAt: state2.elapsedSeconds,
          ray: resolution.request.attackRay
        });
      }
      if (state2.combatTargetGuid === targetGuid) {
        clearCombatTarget(state2);
      }
      return;
    }
    state2.attackPolicy.lastMissedAttackByTarget.delete(targetGuid);
  }
  function applyVulnerabilityOutcome(state2, resolution) {
    const targetGuid = resolution.request.targetGuid;
    if (resolution.request.kind !== "vulnerability" || targetGuid == null) {
      return;
    }
    switch (resolution.outcome.kind) {
      case "succeeded":
        state2.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.set(
          targetGuid,
          state2.elapsedSeconds
        );
        state2.vulnerabilityPolicy.failedVulnAttemptsByTarget.delete(targetGuid);
        return;
      case "resisted":
      case "fizzled":
      case "timed_out":
        incrementVulnerabilityAttempt(state2, targetGuid);
        return;
      case "interrupted":
        if (resolution.outcome.reason === "weenie_error") {
          incrementVulnerabilityAttempt(state2, targetGuid);
        }
        return;
    }
  }
  function incrementVulnerabilityAttempt(state2, targetGuid) {
    const nextAttemptCount = failedVulnAttemptCount(state2, targetGuid) + 1;
    state2.vulnerabilityPolicy.failedVulnAttemptsByTarget.set(
      targetGuid,
      nextAttemptCount
    );
    return nextAttemptCount;
  }
  function logSpellcastResolution(state2, resolution) {
    const description = describeSpellcastRequest(resolution.request);
    const resolvedAt = state2.elapsedSeconds.toFixed(2);
    switch (resolution.outcome.kind) {
      case "succeeded":
        if (resolution.request.kind === "vulnerability") {
          logMageInfo(`cast landed vuln -> ${description} at ${resolvedAt}s`);
          return;
        }
        if (resolution.request.kind === "attack") {
          logMageInfo(`cast landed attack -> ${description} at ${resolvedAt}s`);
          return;
        }
        logMageInfo(`cast completed -> ${description} at ${resolvedAt}s`);
        return;
      case "resisted":
        logMageInfo(`cast resisted -> ${description} at ${resolvedAt}s`);
        return;
      case "fizzled":
        logMageInfo(`cast fizzled -> ${description} at ${resolvedAt}s`);
        return;
      case "missed":
        logMageInfo(`cast missed attack -> ${description} at ${resolvedAt}s`);
        return;
      case "timed_out":
        logMageInfo(`cast timeout -> ${description} at ${resolvedAt}s`);
        return;
      case "interrupted":
        logMageInfo(
          `cast interrupted -> ${description} reason=${resolution.outcome.reason} at ${resolvedAt}s`
        );
        return;
    }
  }
  function isResistMessage(chatEvent, targetName) {
    const message = chatEvent.message.trim().toLowerCase();
    if (!message.endsWith("resists your spell")) {
      return false;
    }
    if (targetName == null) {
      return true;
    }
    const normalizedTargetName = targetName.trim().toLowerCase();
    if (normalizedTargetName.length === 0) {
      return false;
    }
    const expectedMessage = `${normalizedTargetName} resists your spell`;
    const sender = chatEvent.sender?.trim().toLowerCase();
    if (sender == null || sender.length === 0) {
      return message === expectedMessage;
    }
    return sender === normalizedTargetName && message === expectedMessage;
  }
  function isVulnerabilityLandingMessage(request, chatEvent, targetName) {
    if (targetName == null || request.spellName == null) {
      return false;
    }
    const message = normalizeChatMessage(chatEvent.message);
    const expectedPrefix = `you cast ${normalizeChatMessage(request.spellName)} on ${normalizeChatMessage(targetName)}`;
    return message.startsWith(expectedPrefix);
  }
  function isAttackLandingMessage(request, chatEvent, targetName) {
    logMageInfo(
      `checking attack landing -> message="${chatEvent.message}" targetName="${targetName}" spellName="${request.spellName}"`
    );
    if (targetName == null || request.spellName == null) {
      return false;
    }
    const message = normalizeChatMessage(chatEvent.message);
    const spellName = normalizeChatMessage(request.spellName);
    const normalizedTargetName = normalizeChatMessage(targetName);
    if (message.startsWith("you ") && message.includes(` ${normalizedTargetName} `) && message.includes(` with ${spellName}.`)) {
      return true;
    }
    return message.startsWith(`with ${spellName} you drain `) && message.endsWith(` from ${normalizedTargetName}.`);
  }
  function isAttackBlockedMessage(chatEvent, targetName) {
    if (targetName == null) {
      return false;
    }
    const message = normalizeChatMessage(chatEvent.message);
    const normalizedTargetName = normalizeChatMessage(targetName);
    return message === `the lifestone's magic protects ${normalizedTargetName} from the attack!`;
  }
  function normalizeChatMessage(message) {
    return message.trim().toLowerCase();
  }
  function normalizeCastName(name) {
    if (name == null) {
      return null;
    }
    const trimmed = name.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  function createAttackRaySnapshot(from, to) {
    if (!isMeaningfulAttackRay(from, to)) {
      return null;
    }
    return {
      from: cloneWorldPosition(from),
      to: cloneWorldPosition(to)
    };
  }
  function isSimilarAttackRay(left, right) {
    if (left.from.landblockId !== right.from.landblockId || left.to.landblockId !== right.to.landblockId) {
      return false;
    }
    const leftVector = attackVectorBetween(left.from, left.to);
    const rightVector = attackVectorBetween(right.from, right.to);
    if (leftVector == null || rightVector == null) {
      return false;
    }
    const leftDistance = vectorLength(leftVector);
    const rightDistance = vectorLength(rightVector);
    if (attackDistanceBucket(leftDistance) !== attackDistanceBucket(rightDistance)) {
      return false;
    }
    const leftDirection = normalizeVector(leftVector, leftDistance);
    const rightDirection = normalizeVector(rightVector, rightDistance);
    if (leftDirection == null || rightDirection == null) {
      return false;
    }
    const dotProduct = leftDirection.x * rightDirection.x + leftDirection.y * rightDirection.y + leftDirection.z * rightDirection.z;
    return dotProduct >= 0.995;
  }
  function attackVectorBetween(from, to) {
    if (from.landblockId !== to.landblockId) {
      return null;
    }
    return {
      x: to.coords.x - from.coords.x,
      y: to.coords.y - from.coords.y,
      z: to.coords.z - from.coords.z
    };
  }
  function vectorLength(vector) {
    return Math.sqrt(
      vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
    );
  }
  function normalizeVector(vector, length) {
    if (length === 0) {
      return null;
    }
    return {
      x: vector.x / length,
      y: vector.y / length,
      z: vector.z / length
    };
  }
  function attackDistanceBucket(distance) {
    return Math.floor(distance / 2);
  }
  function cloneWorldPosition(position) {
    return {
      landblockId: position.landblockId,
      coords: {
        x: position.coords.x,
        y: position.coords.y,
        z: position.coords.z
      },
      rotation: {
        w: position.rotation.w,
        x: position.rotation.x,
        y: position.rotation.y,
        z: position.rotation.z
      }
    };
  }
  function isMeaningfulAttackRay(from, to) {
    return attackVectorBetween(from, to) != null;
  }
  function describeSpellcastRequest(request) {
    return `${request.kind}:${request.spellId}${request.damageType == null ? "" : `:${request.damageType}`}${request.targetGuid == null ? "" : `:${request.targetGuid}`}`;
  }
  function describeHealingKitUse(request) {
    return `${request.targetGuid}${request.targetName == null ? "" : `:${request.targetName}`}:${request.kitGuid}`;
  }
  function clearHealingKitUse(state2) {
    state2.healingKitPolicy.pendingUse = null;
  }
  function isHealingKitFailureMessage(chatEvent, targetName) {
    if (!isOwnHealingChatSender(chatEvent)) {
      return false;
    }
    const message = normalizeChatMessage(chatEvent.message);
    if (targetName == null) {
      return message.startsWith("you fail to heal ") || message.endsWith(" fails to heal you.");
    }
    const normalizedTargetName = normalizeChatMessage(targetName);
    return message === `you fail to heal ${normalizedTargetName}.` || message.endsWith(" fails to heal you.") && message.includes(normalizedTargetName);
  }
  function isHealingKitSuccessMessage(chatEvent, targetName) {
    if (!isOwnHealingChatSender(chatEvent)) {
      return false;
    }
    const message = normalizeChatMessage(chatEvent.message);
    if (targetName == null) {
      return message.startsWith("you heal ") || message.includes(" heals you for ");
    }
    const normalizedTargetName = normalizeChatMessage(targetName);
    return message.startsWith(`you heal ${normalizedTargetName} for `) || message.includes(` ${normalizedTargetName} `) && message.includes(" heals you for ");
  }
  function isOwnHealingChatSender(chatEvent) {
    const sender = normalizeCastName(chatEvent.sender?.trim() ?? null);
    if (sender == null) {
      return true;
    }
    const selfName = normalizeCastName(HB.selfEntity()?.name?.trim() ?? null);
    if (selfName == null) {
      return true;
    }
    return sender.toLowerCase() === selfName.toLowerCase();
  }

  // src/combat.ts
  function collectMonsterCandidates(self, partyLeader, maxAttackRange, maxAggroDistance) {
    const searchRange = Math.min(maxAggroDistance, maxAttackRange);
    const monsters = HB.nearbyEntities(searchRange, ["monster"]).filter(
      (monster) => !isDefeated(monster)
    );
    return monsters.map((monster) => ({
      guid: monster.guid,
      weenieId: monster.weenieId,
      position: monster.position,
      distanceToSelf: HB.distance(self.guid, monster.guid),
      distanceToParty: partyLeader ? HB.distance(partyLeader.guid, monster.guid) : 0
    })).filter(
      (candidate) => isMonsterCandidateInCombatRange(
        candidate,
        maxAttackRange,
        maxAggroDistance
      )
    );
  }
  function maybeRestoreMana(state2, self, spells) {
    if (ratio(self.mana, self.manaMax) >= SELF_MANA_THRESHOLD) {
      return false;
    }
    if (ratio(self.stamina, self.staminaMax) >= SELF_STAMINA_THRESHOLD) {
      const manaSpell = chooseBestSpell(
        spells,
        {
          school: "life",
          type: "stamina-to-mana",
          targetKind: "self",
          targetGuid: self.guid,
          selfGuid: self.guid,
          preferredSpellIds: state2.config.preferredSpellIds
        },
        HB.distance
      );
      if (manaSpell && castSpell(state2, manaSpell, self.guid)) {
        return true;
      }
    }
    return false;
  }
  function maybeRestoreStamina(state2, self, spells) {
    if (ratio(self.stamina, self.staminaMax) >= SELF_STAMINA_THRESHOLD) {
      return false;
    }
    const revitalizeSpell = chooseBestSpell(
      spells,
      {
        school: "life",
        type: "revitalize",
        targetKind: "self",
        targetGuid: self.guid,
        selfGuid: self.guid,
        preferredSpellIds: state2.config.preferredSpellIds
      },
      HB.distance
    );
    if (revitalizeSpell) {
      return castSpell(state2, revitalizeSpell, self.guid);
    }
    return false;
  }
  function maybeRestoreHealth(state2, self, spells, skills) {
    if (ratio(self.health, self.healthMax) >= SELF_HEALTH_THRESHOLD) {
      return false;
    }
    if (isSkillUsable(skills.get("healing")) && hasRecentHealingKitSuccess(state2, self.guid)) {
      return true;
    }
    if (isSkillUsable(skills.get("healing")) && useHealingKitOnTarget(state2, self.guid)) {
      return true;
    }
    const revitalizeSpell = chooseBestSpell(
      spells,
      {
        school: "life",
        type: "heal",
        targetKind: "self",
        targetGuid: self.guid,
        selfGuid: self.guid,
        preferredSpellIds: state2.config.preferredSpellIds
      },
      HB.distance
    );
    if (revitalizeSpell) {
      return castSpell(state2, revitalizeSpell, self.guid);
    }
    const transferSpell = chooseBestSpell(
      spells,
      {
        school: "life",
        type: "stamina-to-health",
        targetKind: "self",
        targetGuid: self.guid,
        selfGuid: self.guid,
        preferredSpellIds: state2.config.preferredSpellIds
      },
      HB.distance
    );
    if (transferSpell && castSpell(state2, transferSpell, self.guid)) {
      return true;
    }
    return false;
  }
  function maybeHealPartyMember(state2, self, spells, skills) {
    const healTargetGuid = choosePartyHealTarget(self);
    if (healTargetGuid == null) {
      return false;
    }
    if (isSkillUsable(skills.get("healing")) && hasRecentHealingKitSuccess(state2, healTargetGuid)) {
      return true;
    }
    if (isSkillUsable(skills.get("healing")) && useHealingKitOnTarget(state2, healTargetGuid)) {
      return true;
    }
    const healSpell = chooseBestSpell(
      spells,
      {
        school: "life",
        type: "heal",
        targetKind: "other",
        targetGuid: healTargetGuid,
        selfGuid: self.guid,
        preferredSpellIds: state2.config.preferredSpellIds
      },
      HB.distance
    );
    if (healSpell && castSpell(state2, healSpell, healTargetGuid)) {
      return true;
    }
    return false;
  }
  function maybeRevitalizePartyMember(state2, self, spells) {
    const revitalizationTargetGuid = choosePartyRevitalizeTarget(self);
    if (revitalizationTargetGuid == null) {
      return false;
    }
    const revitalizeSpell = chooseBestSpell(
      spells,
      {
        school: "life",
        type: "revitalize",
        targetKind: "other",
        targetGuid: revitalizationTargetGuid,
        selfGuid: self.guid,
        preferredSpellIds: state2.config.preferredSpellIds
      },
      HB.distance
    );
    if (revitalizeSpell && castSpell(state2, revitalizeSpell, revitalizationTargetGuid)) {
      return true;
    }
    return false;
  }
  function maybeCastAttackSpell(state2, self, data, spells, skills, target) {
    const warAttackSpells = knownAttackSpells(spells, "war");
    const voidAttackSpells = knownAttackSpells(spells, "void");
    const preferredDamageTypes = preferredDamageTypesForWeenie(
      data,
      target.weenieId
    );
    const vulnerabilityPolicy = vulnerabilityPolicyForTarget(state2, target.guid);
    logMageInfo(
      `combat decision -> target=${describeAttackTarget(target)} war=${warAttackSpells.length} void=${voidAttackSpells.length} life=${isSkillUsable(skills.get("life")) ? "yes" : "no"} failedVulnAttempts=${vulnerabilityPolicy.failedVulnAttemptCount} preferred=${preferredDamageTypes.join(",")}`
    );
    if (warAttackSpells.length > 0 && isSkillUsable(skills.get("war"))) {
      const warSpell = chooseBestSpell(
        warAttackSpells,
        {
          school: "war",
          type: "attack",
          targetKind: "other",
          targetGuid: target.guid,
          selfGuid: self.guid,
          preferredSpellIds: state2.config.preferredSpellIds,
          preferredDamageTypes
        },
        HB.distance
      );
      if (warSpell != null) {
        logMageInfo(
          `war choice -> ${describeSpell(warSpell)} for ${describeAttackTarget(target)}`
        );
        if (isSkillUsable(skills.get("life")) && warSpell.damageType != null && vulnerabilityPolicy.failedVulnAttemptCount < MAX_VULN_ATTEMPTS_PER_TARGET) {
          const vulnSpell = chooseBestSpell(
            spells,
            {
              school: "life",
              type: "vuln",
              targetKind: "other",
              targetGuid: target.guid,
              selfGuid: self.guid,
              preferredSpellIds: state2.config.preferredSpellIds,
              exactDamageType: warSpell.damageType
            },
            HB.distance
          );
          if (vulnSpell != null && !vulnerabilityPolicy.recentlySucceeded) {
            logMageInfo(
              `vuln choice -> ${describeSpell(vulnSpell)} for ${describeAttackTarget(target)} (attempt ${vulnerabilityPolicy.failedVulnAttemptCount + 1}/${MAX_VULN_ATTEMPTS_PER_TARGET})`
            );
            if (castSpell(state2, vulnSpell, target.guid)) {
              return true;
            }
            logMageInfo(
              `vuln cast rejected -> ${describeSpell(vulnSpell)} for ${describeAttackTarget(target)}`
            );
            return false;
          }
          logMageInfo(
            `vuln skipped -> target=${describeAttackTarget(target)} failedAttempts=${vulnerabilityPolicy.failedVulnAttemptCount} recent=${String(vulnerabilityPolicy.recentlySucceeded)}`
          );
        }
        logMageInfo(
          `attack cast -> ${describeSpell(warSpell)} for ${describeAttackTarget(target)}`
        );
        return castSpell(state2, warSpell, target.guid);
      }
    }
    if (voidAttackSpells.length > 0 && isSkillUsable(skills.get("void"))) {
      const voidSpell = chooseBestSpell(
        voidAttackSpells,
        {
          school: "void",
          type: "attack",
          targetKind: "other",
          targetGuid: target.guid,
          selfGuid: self.guid,
          preferredSpellIds: state2.config.preferredSpellIds
        },
        HB.distance
      );
      if (voidSpell) {
        logMageInfo(
          `void attack cast -> ${describeSpell(voidSpell)} for ${describeAttackTarget(target)}`
        );
        return castSpell(state2, voidSpell, target.guid);
      }
    }
    return false;
  }
  function describeSpell(spell) {
    return `${spell.school}:${spell.type}:${spell.spellId}${spell.damageType == null ? "" : `:${spell.damageType}`}`;
  }
  function describeAttackTarget(target) {
    return `${target.guid}${target.weenieId == null ? "" : `:${target.weenieId}`}${target.reason == null ? "" : `:${target.reason}`}`;
  }

  // src/engine.ts
  function runMage(state2) {
    const self = HB.selfEntity();
    const data = state2.data;
    if (self == null || data == null) {
      return;
    }
    const spellbook = currentSpellbook();
    const skills = currentSkills(data);
    const spells = availableSpells(data, spellbook, skills);
    const warAttackSpells = knownAttackSpells(spells, "war");
    const voidAttackSpells = knownAttackSpells(spells, "void");
    const attackRange = maxSpellRange([...warAttackSpells, ...voidAttackSpells]) ?? 0;
    if (clearNonMageInteraction(state2)) {
      return;
    }
    const party = HB.party();
    const partyLeader = partyLeaderMember(party);
    const separation = updatePartySeparation(
      state2.partySeparationLatched,
      partyLeader == null ? null : HB.distance(self.guid, partyLeader.guid),
      state2.maxPartyDistance
    );
    state2.partySeparationLatched = separation.nextLatched;
    if (partyLeader != null && separation.shouldFollow) {
      if (spellcastBlocksPlanning(state2)) {
        logMageInfo(
          `follow override -> interrupting spellcast for leader ${partyLeader.guid}`
        );
        interruptSpellcast(state2, "follow_override");
        if (self.busyOperation !== "none") {
          HB.cancelInteraction();
        }
      }
      followPartyLeader(state2, self, partyLeader);
      return;
    }
    let bypassBusy = false;
    if (spellcastBlocksPlanning(state2)) {
      if (self.busyOperation === "spell_cast") {
        observeSpellCastBusy(state2);
      }
      if (resolveSpellcastFromTimeout(state2)) {
        bypassBusy = true;
        if (self.busyOperation !== "none") {
          HB.cancelInteraction();
        }
      } else if (self.busyOperation === "none") {
        resolveSpellcastFromIdle(state2);
        if (spellcastBlocksPlanning(state2)) {
          return;
        }
      } else {
        return;
      }
    }
    if (healingKitUseBlocksPlanning(state2)) {
      if (!resolveHealingKitUseFromTimeout(state2)) {
        return;
      }
    }
    if (self.busyOperation !== "none" && !bypassBusy) {
      return;
    }
    if (maybeRestoreHealth(state2, self, spells, skills)) {
      return;
    }
    if (maybeRestoreStamina(state2, self, spells)) {
      return;
    }
    if (maybeRestoreMana(state2, self, spells)) {
      return;
    }
    if (maybeHealPartyMember(state2, self, spells, skills)) {
      return;
    }
    if (maybeRevitalizePartyMember(state2, self, spells)) {
      return;
    }
    const currentInteraction = HB.currentInteraction();
    let target = null;
    const activeCombatTarget = resolveCombatTarget(
      state2,
      self,
      partyLeader,
      attackRange
    );
    if (activeCombatTarget != null) {
      target = {
        guid: activeCombatTarget.guid,
        reason: "combat-target",
        weenieId: activeCombatTarget.weenieId
      };
      logMageInfo(`combat target resolved -> ${describeAttackTarget2(target)}`);
    } else {
      const candidates = collectMonsterCandidates(
        self,
        partyLeader,
        attackRange,
        state2.maxAggroDistance
      );
      const availableCandidates = candidates.filter(
        (candidate) => !hasRecentMissedAttack(state2, self, candidate)
      );
      const selection = selectAttackTarget(
        availableCandidates,
        partyLeader != null
      );
      if (selection.target != null) {
        setCombatTarget(state2, selection.target.guid);
        target = selection.target;
        const preferredTarget = `${selection.target.guid}${selection.target.weenieId == null ? "" : `:${selection.target.weenieId}`}`;
        logMageInfo(
          `attack target -> ${preferredTarget} (${selection.target.reason}); candidates=${candidates.length}`
        );
      } else if (candidates.length > 0) {
        if (availableCandidates.length === 0) {
          logMageInfo(
            `combat scan -> ${candidates.length} candidates but all recently missed`
          );
        }
        logMageInfo(
          `combat scan -> ${candidates.length} candidates but no target selected`
        );
      }
    }
    if (target != null && currentInteraction?.kind === "Follow") {
      logMageInfo(`follow -> combat-target ${target.guid}`);
      HB.cancelInteraction();
      return;
    }
    if (target != null) {
      if (maybeCastAttackSpell(state2, self, data, spells, skills, target)) {
        return;
      }
      return;
    }
    if (partyLeader != null) {
      followPartyLeader(state2, self, partyLeader);
    }
  }
  function describeAttackTarget2(target) {
    return `${target.guid}${target.weenieId == null ? "" : `:${target.weenieId}`}:${target.reason}`;
  }

  // src/runtime-config.ts
  function loadMageConfig(data) {
    const rawConfig = HB.loadConfig();
    if (rawConfig == null) {
      HB.print("warn", `No mage config found. Using default spells.`);
    }
    return normalizeMageConfig(rawConfig, data);
  }
  function normalizeMageConfig(rawConfig, data) {
    if (rawConfig == null || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      return {
        preferredSpellIds: [],
        bannedSpellIds: []
      };
    }
    const config = rawConfig;
    return {
      preferredSpellIds: normalizePreferredSpells(config.preferredSpells, data),
      bannedSpellIds: normalizePreferredSpells(config.bannedSpells, data)
    };
  }
  function normalizePreferredSpells(value, data) {
    if (!Array.isArray(value)) {
      return [];
    }
    const preferredSpellIds = [];
    const seenSpellIds = /* @__PURE__ */ new Set();
    for (const entry of value) {
      const preferredSpellId = resolvePreferredSpellId(entry, data);
      if (preferredSpellId == null || seenSpellIds.has(preferredSpellId)) {
        continue;
      }
      seenSpellIds.add(preferredSpellId);
      preferredSpellIds.push(preferredSpellId);
    }
    return preferredSpellIds;
  }
  function resolvePreferredSpellId(entry, data) {
    if (typeof entry === "number" && Number.isInteger(entry) && entry > 0) {
      return entry;
    }
    if (typeof entry !== "string") {
      return null;
    }
    const preferredSpellKey = entry.trim();
    if (preferredSpellKey.length === 0 || data == null) {
      return null;
    }
    const spell = data.spells[preferredSpellKey];
    return spell?.spellId ?? null;
  }

  // src/runtime-data.ts
  function loadMageDataWithStatus() {
    const rawData = HB.loadData();
    const rawResistData = HB.loadDataBin();
    const resistBytes = coerceResistBytes(rawResistData);
    return {
      data: normalizeMageData(rawData, resistBytes),
      hasJson: rawData != null,
      hasBin: resistBytes != null
    };
  }
  function normalizeMageData(rawData, rawResistData) {
    if (rawData == null || typeof rawData !== "object" || Array.isArray(rawData)) {
      return null;
    }
    if (!isUint8Array(rawResistData)) {
      return null;
    }
    const data = rawData;
    if (data.spells == null || data.skills == null || typeof data.spells !== "object" || typeof data.skills !== "object") {
      return null;
    }
    const spells = {};
    for (const [school, schoolSpells] of Object.entries(data.spells)) {
      if (!isMageSpellSchool(school) || !isSpellGroup(schoolSpells)) {
        return null;
      }
      for (const [spellKey, spell] of Object.entries(schoolSpells)) {
        if (!isMageSpellFileRecord(spell)) {
          return null;
        }
        spells[spellKey] = {
          name: spell.name,
          spellId: spell.spellId,
          school,
          type: spell.type,
          difficulty: spell.difficulty,
          damageType: spell.damageType ?? null,
          range: spell.range ?? null,
          targetKind: spell.targetKind
        };
      }
    }
    return {
      spells,
      skills: data.skills,
      weenieResists: rawResistData
    };
  }
  function filterMageDataSpells(data, bannedSpellIds) {
    if (data == null || bannedSpellIds.length === 0) {
      return data;
    }
    const bannedSpellIdSet = new Set(bannedSpellIds);
    if (bannedSpellIdSet.size === 0) {
      return data;
    }
    const filteredSpells = Object.fromEntries(
      Object.entries(data.spells).filter(
        ([, spell]) => !bannedSpellIdSet.has(spell.spellId)
      )
    );
    if (Object.keys(filteredSpells).length === Object.keys(data.spells).length) {
      return data;
    }
    return {
      ...data,
      spells: filteredSpells
    };
  }
  function isUint8Array(value) {
    return value instanceof Uint8Array;
  }
  function coerceResistBytes(value) {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
      return Uint8Array.from(value);
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
  }
  function isMageSpellSchool(value) {
    return value === "war" || value === "life" || value === "void";
  }
  function isSpellGroup(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
  }
  function isMageSpellFileRecord(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const spell = value;
    return typeof spell.name === "string" && typeof spell.spellId === "number" && typeof spell.type === "string" && typeof spell.difficulty === "number" && typeof spell.targetKind === "string";
  }

  // src/state.ts
  function createInitialState() {
    return {
      data: null,
      config: {
        preferredSpellIds: [],
        bannedSpellIds: []
      },
      elapsedSeconds: 0,
      combatTargetGuid: null,
      spellcast: { phase: "idle" },
      partySeparationLatched: false,
      maxPartyDistance: MAX_PARTY_DISTANCE,
      maxAggroDistance: MAX_AGGRO_DISTANCE,
      actionTimes: /* @__PURE__ */ new Map(),
      attackPolicy: {
        lastMissedAttackByTarget: /* @__PURE__ */ new Map()
      },
      healingKitPolicy: {
        pendingUse: null,
        lastSuccessfulUseAtByTarget: /* @__PURE__ */ new Map()
      },
      vulnerabilityPolicy: {
        failedVulnAttemptsByTarget: /* @__PURE__ */ new Map(),
        lastSuccessfulVulnAtByTarget: /* @__PURE__ */ new Map()
      }
    };
  }
  function resetState(state2) {
    state2.elapsedSeconds = 0;
    state2.combatTargetGuid = null;
    state2.spellcast = { phase: "idle" };
    state2.partySeparationLatched = false;
    state2.maxPartyDistance = MAX_PARTY_DISTANCE;
    state2.maxAggroDistance = MAX_AGGRO_DISTANCE;
    state2.actionTimes.clear();
    state2.attackPolicy.lastMissedAttackByTarget.clear();
    state2.healingKitPolicy.pendingUse = null;
    state2.healingKitPolicy.lastSuccessfulUseAtByTarget.clear();
    state2.vulnerabilityPolicy.failedVulnAttemptsByTarget.clear();
    state2.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.clear();
  }

  // src/index.ts
  var state = createInitialState();
  function parsePositiveNumberArg(args, flagName) {
    const prefix = `${flagName}=`;
    const token = args.trim().split(/\s+/).find((candidate) => candidate.startsWith(prefix));
    if (token == null) {
      return null;
    }
    const parsed = Number(token.slice(prefix.length));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  function handleMessageEvent(message, sender, sourceLabel) {
    const spellcastRequest = currentSpellcastRequest(state);
    const pendingTargetName = spellcastRequest?.targetName ?? (spellcastRequest?.targetGuid == null ? null : HB.entity(spellcastRequest.targetGuid)?.name?.trim() ?? null);
    logMageInfo(
      `${sourceLabel} received: message="${message}" pendingTargetName="${pendingTargetName}"`
    );
    if (resolveHealingKitUseFromChatMessage(
      state,
      { sender, message },
      pendingTargetName
    ) || resolveSpellcastFromChatMessage(
      state,
      { sender, message },
      pendingTargetName
    )) {
      runMage(state);
    }
  }
  function handleCombatFeedbackEvent(feedback) {
    if (resolveSpellcastFromCombatFeedback(state, feedback)) {
      runMage(state);
    }
  }
  HB.onEvent((event) => {
    switch (event.kind) {
      case "chat_message": {
        handleMessageEvent(event.data.message, event.data.sender, "chat_message");
        return;
      }
      case "combat_feedback": {
        handleCombatFeedbackEvent(event.data);
        return;
      }
      case "teleport_started": {
        cancelCombatPlanning(state);
        return;
      }
      case "weenie_error": {
        if (resolveSpellcastFromWeenieError(state)) {
          runMage(state);
        }
        return;
      }
      case "workflow": {
        if (event.data.kind === "busy_operation_changed") {
          if (event.data.data.busy === "spell_cast") {
            observeSpellCastBusy(state);
          }
          if (event.data.data.busy === "none") {
            resolveSpellcastFromIdle(state);
            runMage(state);
            return;
          }
        }
        return;
      }
      case "entity_disappeared": {
        if (state.combatTargetGuid === event.data.guid) {
          clearCombatTarget(state);
        }
        clearAttackHistory(state, event.data.guid);
        clearHealingKitHistory(state, event.data.guid);
        clearVulnerabilityAttemptHistory(state, event.data.guid);
        return;
      }
      case "lifecycle": {
        switch (event.data.kind) {
          case "started": {
            resetState(state);
            const loadStatus = loadMageDataWithStatus();
            state.config = loadMageConfig(loadStatus.data);
            state.data = filterMageDataSpells(
              loadStatus.data,
              state.config.bannedSpellIds
            );
            state.maxPartyDistance = parsePositiveNumberArg(event.data.data.args, "max-party-dist") ?? MAX_PARTY_DISTANCE;
            state.maxAggroDistance = parsePositiveNumberArg(event.data.data.args, "aggro-dist") ?? state.maxAggroDistance;
            logMageInfo("started");
            if (state.data == null) {
              HB.print(
                "warn",
                `mage script started without usable mage data (json=${loadStatus.hasJson}, bin=${loadStatus.hasBin})`
              );
            } else {
              HB.print(
                "info",
                `loaded mage data: ${Object.keys(state.data.spells).length} spells, ${Object.keys(state.data.skills).length} skills`
              );
            }
            runMage(state);
            return;
          }
          case "stopped": {
            resetState(state);
            return;
          }
          case "tick": {
            state.elapsedSeconds += event.data.data.elapsedSeconds;
            runMage(state);
            return;
          }
        }
        return;
      }
      default:
        return;
    }
  });
})();
