import { describe, expect, it } from "vitest";
import { itemStructureDisplay } from "./item-structure";

describe("itemStructureDisplay", () => {
	it.each([
		null,
		{ current: null, max: null },
		{ current: 5, max: null },
		{ current: null, max: 10 },
		{ current: 10, max: 10 },
		{ current: 0, max: 0 },
	])("hides absent, incomplete, or full structure: %j", (structure) => {
		expect(itemStructureDisplay(structure)).toBeNull();
	});
	it.each([
		[{ current: 32, max: 50 }, "[32/50]", 0.64],
		[{ current: 2000, max: 4000 }, "[2,000/4,000]", 0.5],
		[{ current: 0, max: 50 }, "[0/50]", 0],
		[{ current: 60, max: 50 }, "[60/50]", 1],
		[{ current: 1, max: 0 }, "[1/0]", 0],
	] as const)(
		"retains exact values with a bounded bar: %j",
		(structure, label, fraction) => {
			expect(itemStructureDisplay(structure)).toEqual({ label, fraction });
		},
	);
});
