import { describe, expect, it } from "vitest";

import { closestMinimapSelectionGuid } from "./minimap-selection";

describe("minimap selection", () => {
	it("chooses distance before GUID and GUID for an exact tie", () => {
		expect(
			closestMinimapSelectionGuid(
				[
					{ guid: 9, x: 10, y: 10 },
					{ guid: 2, x: 12, y: 10 },
				],
				12,
				10,
				8,
			),
		).toBe(2);
		expect(
			closestMinimapSelectionGuid(
				[
					{ guid: 9, x: 10, y: 10 },
					{ guid: 2, x: 14, y: 10 },
				],
				12,
				10,
				8,
			),
		).toBe(2);
	});

	it("returns null for a successful empty click", () => {
		expect(
			closestMinimapSelectionGuid([{ guid: 2, x: 30, y: 30 }], 0, 0, 8),
		).toBeNull();
	});
});
