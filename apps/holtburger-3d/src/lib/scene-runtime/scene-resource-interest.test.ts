import { describe, expect, it } from "vitest";

import {
	createSceneResourceInterest,
	describeSceneResourceInterestKey,
} from "./scene-resource-interest";

describe("scene resource interest", () => {
	it("normalizes locations and creates stable mode-neutral keys", () => {
		const interest = createSceneResourceInterest({
			location: {
				kind: "interior-cell",
				landblockId: 0xda550155,
				envCellId: 0xda550155,
			},
			lod: {
				terrain: 2,
				buildings: 1,
				detail: 0,
				envCells: -1,
			},
		});

		expect(interest.location).toEqual({
			kind: "interior-cell",
			landblockId: 0xda55ffff,
			envCellId: 0xda550155,
		});
		expect(describeSceneResourceInterestKey(interest)).toBe(
			"interior:0xda550155:terrain-2:buildings-1:detail-0:env-cells--1",
		);
	});
});
