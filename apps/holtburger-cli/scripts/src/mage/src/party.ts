import {
	HEALING_DISTANCE,
	PARTY_HEAL_THRESHOLD,
	PARTY_REVITALIZE_THRESHOLD,
} from "./constants";
import { isDefeated, ratio } from "./runtime-helpers";
import type { Fellowship, FellowshipMember } from "./types";

type PartyPercentTarget = {
	guid: Guid;
	percent: number;
	distance: number;
};

export function currentFellowship(): Fellowship | null {
	const social = HB.social();
	const fellowship = social?.fellowship;
	if (
		fellowship == null ||
		typeof fellowship !== "object" ||
		Array.isArray(fellowship) ||
		!Array.isArray((fellowship as Fellowship).members)
	) {
		return null;
	}
	return fellowship as Fellowship;
}

export function partyLeaderMember(
	party: Fellowship | null,
): FellowshipMember | null {
	if (party == null || party.leader_guid == null) {
		return null;
	}

	return (
		party.members.find(
			(member) =>
				member.guid === party.leader_guid && HB.entity(member.guid) != null,
		) ?? null
	);
}

export function choosePartyHealTarget(self: SelfView): Guid | null {
	return choosePartyMemberBelowThreshold(
		self,
		PARTY_HEAL_THRESHOLD,
		(member) =>
			member.max_health > 0
				? ratio(member.current_health, member.max_health)
				: null,
	);
}

export function choosePartyRevitalizeTarget(self: SelfView): Guid | null {
	return choosePartyMemberBelowThreshold(
		self,
		PARTY_REVITALIZE_THRESHOLD,
		(member) =>
			member.max_stamina > 0
				? ratio(member.current_stamina, member.max_stamina)
				: null,
	);
}

function choosePartyMemberBelowThreshold(
	self: SelfView,
	threshold: number,
	percentForMember: (member: FellowshipMember) => number | null,
): Guid | null {
	const party = currentFellowship();
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
		if (!Number.isFinite(distance) || distance > HEALING_DISTANCE) {
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
