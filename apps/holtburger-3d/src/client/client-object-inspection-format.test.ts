import { describe, expect, it } from "vitest";
import {
	formatInspectionDamageTypes,
	formatInspectionDuration,
	formatInspectionEffect,
	formatInspectionImbuedEffects,
	formatInspectionNumber,
	formatItemStatuses,
	formatPlayerKillerStatus,
	formatWieldRequirement,
	humanizeInspectionName,
} from "./client-object-inspection-format";

describe("object inspection formatting", () => {
	it("humanizes open semantic enum names", () => {
		expect(humanizeInspectionName("BlackGarnet")).toBe("Black Garnet");
		expect(humanizeInspectionName("max-health")).toBe("Max Health");
	});

	it("keeps mixed and unknown damage bits visible", () => {
		expect(formatInspectionDamageTypes(0x8000_0011)).toBe(
			"Slashing / Fire / Unknown damage bits 0x80000000",
		);
	});

	it("keeps known and unknown imbue bits visible", () => {
		expect(formatInspectionImbuedEffects(0x1000_0001)).toEqual([
			"Critical Strike",
			"Unknown imbue bits 0x10000000",
		]);
	});

	it("groups inspection numbers with US-style commas", () => {
		expect(formatInspectionNumber(125000)).toBe("125,000");
		expect(formatInspectionNumber(12345.6)).toBe("12,345.6");
	});

	it("omits mana-duration seconds at one hour and above", () => {
		expect(formatInspectionDuration(27_450)).toBe("7h 37m");
		expect(formatInspectionDuration(3_630)).toBe("1h");
		expect(formatInspectionDuration(3_599)).toBe("59m 59s");
		expect(formatInspectionDuration(2_220)).toBe("37m");
		expect(formatInspectionDuration(30)).toBe("30s");
	});

	it("preserves retail's character PK labels", () => {
		expect(formatPlayerKillerStatus("non-player-killer")).toBe(
			"Non-Player Killer",
		);
		expect(formatPlayerKillerStatus("player-killer-lite")).toBe(
			"Player Killer Lite",
		);
	});

	it("surfaces equipment appraisal resistance as Unenchantable", () => {
		expect(
			formatItemStatuses({
				bonded: null,
				attuned: null,
				retained: null,
				isOpen: null,
				isLocked: null,
				sellable: null,
				ivoryable: null,
				unenchantable: true,
			}),
		).toEqual(["Unenchantable"]);
	});

	it("formats every tagged shape without re-deriving semantics", () => {
		expect(
			formatWieldRequirement({
				type: "training",
				data: { skill: "HeavyWeapons", level: "specialized" },
			}),
		).toBe("Heavy Weapons: Specialized");
		expect(
			formatInspectionEffect({
				type: "slayer",
				data: { creatureType: "Olthoi", bonus: 0.15 },
			}),
		).toBe("Slayer: Olthoi (15%)");
	});
});
