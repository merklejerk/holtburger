import type { PartySnapshot } from "./client-party-contract";
import { describe, expect, it } from "vitest";
import { partyVitalDisplay, presentPartyHud } from "./client-party-hud";

describe("party vital display", () => {
	it("represents a zero maximum as unavailable rather than dead", () => {
		expect(partyVitalDisplay(0, 0)).toEqual({
			percent: null,
			quantity: "Unavailable",
		});
	});
	it("shows exact quantities while bounding over-maximum fills", () => {
		expect(partyVitalDisplay(25, 20)).toEqual({
			percent: 100,
			quantity: "25 / 20",
		});
	});
	it("distinguishes depleted and partially depleted vitals", () => {
		expect(partyVitalDisplay(0, 20)).toEqual({
			percent: 0,
			quantity: "0 / 20",
		});
		expect(partyVitalDisplay(5, 20)).toEqual({
			percent: 25,
			quantity: "5 / 20",
		});
	});
});

describe("teammate presentation", () => {
	const party: PartySnapshot = {
		name: "Party",
		leader: 2,
		shareXp: false,
		evenShare: false,
		open: false,
		locked: false,
		capabilities: { isLeader: true, canRecruit: true, canChangeOpenness: true },
		members: [3, 2, 1].map((guid) => ({
			guid,
			name: `Member ${guid}`,
			level: 1,
			canManage: false,
			vitals: [10, 20, 30, 40, 50, 60],
		})),
	};
	it("excludes self wherever it occurs without changing roster order or vital facts", () => {
		const display = presentPartyHud(party, 2);
		if (display === null) throw new Error("Missing hydrated display");
		expect(display.members.map((member) => member.guid)).toEqual([3, 1]);
		expect(display.members[0]).toBe(party.members[0]);
		expect(display.members[1]).toBe(party.members[2]);
		expect(display.leader).toBe(2);
		expect(party.members.map((member) => member.guid)).toEqual([3, 2, 1]);
	});
	it("requires player identity and retains teammate leadership", () => {
		expect(presentPartyHud(party, null)).toBeNull();
		expect(presentPartyHud(null, 1)).toBeNull();
		expect(presentPartyHud(party, 1)?.leader).toBe(2);
	});
});
