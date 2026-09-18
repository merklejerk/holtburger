import { describe, expect, it } from "vitest";
import {
	formatInspectionDamageTypes,
	formatInspectionEffect,
	formatInspectionImbuedEffects,
	formatInspectionNumber,
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

	it("preserves retail's character PK labels", () => {
		expect(formatPlayerKillerStatus("non-player-killer")).toBe(
			"Non-Player Killer",
		);
		expect(formatPlayerKillerStatus("player-killer-lite")).toBe(
			"Player Killer Lite",
		);
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
