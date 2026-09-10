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

it("selects either end and the middle of a door, with deterministic overlap", () => {
	const door = { guid: 4, x: -30, y: 0, end: { x: 30, y: 0 } };
	for (const x of [-30, 0, 30])
		expect(closestMinimapSelectionGuid([door], x, 2, 3)).toBe(4);
	expect(closestMinimapSelectionGuid([door], 34, 0, 3)).toBeNull();
	expect(closestMinimapSelectionGuid([door], 0, 4, 3)).toBeNull();
	expect(
		closestMinimapSelectionGuid([door, { guid: 2, x: 0, y: 0 }], 0, 0, 3),
	).toBe(2);
	expect(
		closestMinimapSelectionGuid(
			[{ guid: 4, x: 0, y: 0, end: { x: 0, y: 0 } }],
			0,
			0,
			3,
		),
	).toBe(4);
});
