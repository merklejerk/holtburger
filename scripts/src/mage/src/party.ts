import {
	HEALING_DISTANCE,
	PARTY_HEAL_THRESHOLD,
	PARTY_REVITALIZE_THRESHOLD,
} from "./constants";
import { isDefeated } from "./runtime-helpers";

type PartyPercentTarget = {
	guid: Guid;
	percent: number;
	distance: number;
};

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
	return choosePartyMemberBelowThreshold(
		self,
		PARTY_HEAL_THRESHOLD,
		(member) => member.healthPercent,
	);
}

export function choosePartyRevitalizeTarget(self: ScriptSelfView): Guid | null {
	return choosePartyMemberBelowThreshold(
		self,
		PARTY_REVITALIZE_THRESHOLD,
		(member) => member.staminaPercent,
	);
}

function choosePartyMemberBelowThreshold(
	self: ScriptSelfView,
	threshold: number,
	percentForMember: (member: ScriptPartyMemberView) => number | null,
): Guid | null {
	const party = HB.party();
	if (!party) {
		return null;
	}

	const candidates: PartyPercentTarget[] = [];

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
			distance,
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
