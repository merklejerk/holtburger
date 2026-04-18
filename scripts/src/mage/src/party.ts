import { HEALING_DISTANCE, PARTY_HEAL_THRESHOLD } from "./constants";
import { isDefeated } from "./runtime-helpers";

export function partyLeaderMember(
  party: ScriptPartyView | null,
): ScriptPartyMemberView | null {
  if (party == null) {
    return null;
  }

  return (
    party.members.find(
      (member) =>
        member.guid === party.leaderGuid && HB.entityExists(member.guid),
    ) ?? null
  );
}

export function choosePartyHealTarget(self: ScriptSelfView): Guid | null {
  const party = HB.party();
  if (!party) {
    return null;
  }

  const members = party.members
    .filter((member) => member.guid !== self.guid)
    .filter((member) => member.healthPercent != null)
    .filter((member) => (member.healthPercent ?? 1) < PARTY_HEAL_THRESHOLD)
    .filter((member) => HB.distance(self.guid, member.guid) <= HEALING_DISTANCE)
    .filter((member) => !isDefeated(HB.entity(member.guid)));

  members.sort((left, right) => {
    const leftHealth = left.healthPercent ?? 1;
    const rightHealth = right.healthPercent ?? 1;
    if (leftHealth !== rightHealth) {
      return leftHealth - rightHealth;
    }
    return (
      HB.distance(self.guid, left.guid) - HB.distance(self.guid, right.guid)
    );
  });

  return members[0]?.guid ?? null;
}
