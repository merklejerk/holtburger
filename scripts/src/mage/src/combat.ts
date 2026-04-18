import {
  MAX_VULN_ATTEMPTS_PER_TARGET,
  MAX_AGGRO_DISTANCE,
  SELF_HEALTH_THRESHOLD,
  SELF_MANA_THRESHOLD,
  SELF_STAMINA_THRESHOLD,
} from "./constants";
import {
  chooseBestSpell,
  knownAttackSpells,
  preferredDamageTypesForWeenie,
} from "./domain/spells";
import {
  isMonsterCandidateInCombatRange,
} from "./domain/targeting";
import { choosePartyHealTarget } from "./party";
import {
  castSpell,
  logMageInfo,
  useHealingKitOnTarget,
  vulnerabilityPolicyForTarget,
} from "./runtime-actions";
import { isDefeated, ratio } from "./runtime-helpers";
import { isSkillUsable } from "./skills";
import type {
  AttackTarget,
  MageData,
  MageRuntimeState,
  MageSpellRecord,
  MonsterCandidate,
  SkillSnapshot,
} from "./types";

export function collectMonsterCandidates(
  self: ScriptSelfView,
  partyLeader: ScriptPartyMemberView | null,
  maxAttackRange: number,
): MonsterCandidate[] {
  const searchRange = Math.min(MAX_AGGRO_DISTANCE, maxAttackRange);
  const monsters = HB.nearbyEntities(searchRange, ["monster"]).filter(
    (monster) => !isDefeated(monster),
  );

  return monsters
    .map((monster) => ({
      guid: monster.guid,
      weenieId: monster.weenieId,
      position: monster.position,
      distanceToSelf: HB.distance(self.guid, monster.guid),
      distanceToParty: partyLeader ? HB.distance(partyLeader.guid, monster.guid) : 0,
    }))
    .filter((candidate) =>
      isMonsterCandidateInCombatRange(
        candidate,
        maxAttackRange,
      ),
    );
}

export function maybeRestoreMana(
  state: MageRuntimeState,
  self: ScriptSelfView,
  spells: MageSpellRecord[],
): boolean {
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
      },
      HB.distance,
    );
    if (manaSpell && castSpell(state, manaSpell, self.guid)) {
      return true;
    }
  }

  const revitalizeSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "revitalize",
      targetKind: "self",
      targetGuid: self.guid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (revitalizeSpell) {
    return castSpell(state, revitalizeSpell, self.guid);
  }

  return false;
}

export function maybeRestoreStamina(
  state: MageRuntimeState,
  self: ScriptSelfView,
  spells: MageSpellRecord[],
): boolean {
  if (ratio(self.stamina, self.staminaMax) >= SELF_STAMINA_THRESHOLD) {
    return false;
  }

  const manaSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "mana-to-stamina",
      targetKind: "self",
      targetGuid: self.guid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (manaSpell && castSpell(state, manaSpell, self.guid)) {
    return true;
  }

  const healthSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "health-to-stamina",
      targetKind: "self",
      targetGuid: self.guid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (healthSpell && castSpell(state, healthSpell, self.guid)) {
    return true;
  }

  const revitalizeSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "revitalize",
      targetKind: "self",
      targetGuid: self.guid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (revitalizeSpell) {
    return castSpell(state, revitalizeSpell, self.guid);
  }

  return false;
}

export function maybeRestoreHealth(
  state: MageRuntimeState,
  self: ScriptSelfView,
  spells: MageSpellRecord[],
  skills: Map<string, SkillSnapshot>,
): boolean {
  if (ratio(self.health, self.healthMax) >= SELF_HEALTH_THRESHOLD) {
    return false;
  }

  if (
    isSkillUsable(skills.get("healing")) &&
    useHealingKitOnTarget(state, self.guid)
  ) {
    return true;
  }

  const transferSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "stamina-to-health",
      targetKind: "self",
      targetGuid: self.guid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (transferSpell && castSpell(state, transferSpell, self.guid)) {
    return true;
  }

  const revitalizeSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "revitalize",
      targetKind: "self",
      targetGuid: self.guid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (revitalizeSpell) {
    return castSpell(state, revitalizeSpell, self.guid);
  }

  return false;
}

export function maybeHealPartyMember(
  state: MageRuntimeState,
  self: ScriptSelfView,
  spells: MageSpellRecord[],
  skills: Map<string, SkillSnapshot>,
): boolean {
  const healTargetGuid = choosePartyHealTarget(self);
  if (healTargetGuid == null) {
    return false;
  }

  if (
    isSkillUsable(skills.get("healing")) &&
    useHealingKitOnTarget(state, healTargetGuid)
  ) {
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
    },
    HB.distance,
  );
  if (healSpell && castSpell(state, healSpell, healTargetGuid)) {
    return true;
  }

  const revitalizeSpell = chooseBestSpell(
    spells,
    {
      school: "life",
      type: "revitalize",
      targetKind: "other",
      targetGuid: healTargetGuid,
      selfGuid: self.guid,
    },
    HB.distance,
  );
  if (revitalizeSpell) {
    return castSpell(state, revitalizeSpell, healTargetGuid);
  }

  return false;
}

export function maybeCastAttackSpell(
  state: MageRuntimeState,
  self: ScriptSelfView,
  data: MageData,
  spells: MageSpellRecord[],
  skills: Map<string, SkillSnapshot>,
  target: AttackTarget,
): boolean {
  const warAttackSpells = knownAttackSpells(spells, "war");
  const voidAttackSpells = knownAttackSpells(spells, "void");
  const preferredDamageTypes = preferredDamageTypesForWeenie(data, target.weenieId);
  const vulnerabilityPolicy = vulnerabilityPolicyForTarget(state, target.guid);

  logMageInfo(
    `combat decision -> target=${describeAttackTarget(target)} war=${warAttackSpells.length} void=${voidAttackSpells.length} life=${isSkillUsable(skills.get("life")) ? "yes" : "no"} failedVulnAttempts=${vulnerabilityPolicy.failedVulnAttemptCount} preferred=${preferredDamageTypes.join(",")}`,
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
        preferredDamageTypes,
      },
      HB.distance,
    );
    if (warSpell != null) {
      logMageInfo(
        `war choice -> ${describeSpell(warSpell)} for ${describeAttackTarget(target)}`,
      );
      if (
        isSkillUsable(skills.get("life")) &&
        warSpell.damageType != null &&
        vulnerabilityPolicy.failedVulnAttemptCount < MAX_VULN_ATTEMPTS_PER_TARGET
      ) {
        const vulnSpell = chooseBestSpell(
          spells,
          {
            school: "life",
            type: "vuln",
            targetKind: "other",
            targetGuid: target.guid,
            selfGuid: self.guid,
            exactDamageType: warSpell.damageType,
          },
          HB.distance,
        );
        if (
          vulnSpell != null &&
          !vulnerabilityPolicy.recentlySucceeded
        ) {
          logMageInfo(
            `vuln choice -> ${describeSpell(vulnSpell)} for ${describeAttackTarget(target)} (attempt ${vulnerabilityPolicy.failedVulnAttemptCount + 1}/${MAX_VULN_ATTEMPTS_PER_TARGET})`,
          );
          if (castSpell(state, vulnSpell, target.guid)) {
            return true;
          }

          logMageInfo(
            `vuln cast rejected -> ${describeSpell(vulnSpell)} for ${describeAttackTarget(target)}`,
          );
          return false;
        }

        logMageInfo(
          `vuln skipped -> target=${describeAttackTarget(target)} failedAttempts=${vulnerabilityPolicy.failedVulnAttemptCount} recent=${String(vulnerabilityPolicy.recentlySucceeded)}`,
        );
      }

      logMageInfo(
        `attack cast -> ${describeSpell(warSpell)} for ${describeAttackTarget(target)}`,
      );
      return castSpell(state, warSpell, target.guid);
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
      },
      HB.distance,
    );
    if (voidSpell) {
      logMageInfo(
        `void attack cast -> ${describeSpell(voidSpell)} for ${describeAttackTarget(target)}`,
      );
      return castSpell(state, voidSpell, target.guid);
    }
  }

  return false;
}

function describeSpell(spell: MageSpellRecord): string {
  return `${spell.school}:${spell.type}:${spell.spellId}${spell.damageType == null ? "" : `:${spell.damageType}`}`;
}

function describeAttackTarget(target: AttackTarget): string {
  return `${target.guid}${target.weenieId == null ? "" : `:${target.weenieId}`}${target.reason == null ? "" : `:${target.reason}`}`;
}
