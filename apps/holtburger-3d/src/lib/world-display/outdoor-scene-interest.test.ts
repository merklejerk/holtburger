import { describe, expect, it } from "vitest";

import { makeOutdoorLandblockId } from "../landblocks";
import {
	deriveOutdoorSceneInterest,
	unionOutdoorSceneLandblockIds,
} from "./outdoor-scene-interest";

describe("deriveOutdoorSceneInterest", () => {
	it("normalizes focus landblock and derives deterministic interest sets", () => {
		const interest = deriveOutdoorSceneInterest({
			focusLandblockId: 0x05050003,
			terrainRadius: 2,
			buildingRadius: 1,
			detailRadius: 0,
		});

		expect(interest.focusLandblockId).toBe(0x0505ffff);
		expect(interest.terrainLandblockIds).toHaveLength(25);
		expect(interest.buildingLandblockIds).toHaveLength(9);
		expect(interest.detailLandblockIds).toEqual([0x0505ffff]);
		expect(interest.terrainLandblockIds[0]).toBe(0x0505ffff);
		expect(interest.buildingLandblockIds[0]).toBe(0x0505ffff);
	});

	it("clamps invalid radii to ordered non-negative integers", () => {
		const interest = deriveOutdoorSceneInterest({
			focusLandblockId: 0x0102ffff,
			terrainRadius: 1.9,
			buildingRadius: 4,
			detailRadius: 3,
		});

		expect(interest.terrainRadius).toBe(1);
		expect(interest.buildingRadius).toBe(1);
		expect(interest.detailRadius).toBe(1);
		expect(interest.terrainLandblockIds).toHaveLength(9);
		expect(interest.buildingLandblockIds).toHaveLength(9);
		expect(interest.detailLandblockIds).toHaveLength(9);
	});

	it("omits map-edge landblocks outside valid outdoor coordinates", () => {
		const interest = deriveOutdoorSceneInterest({
			focusLandblockId: makeOutdoorLandblockId(0, 0),
			terrainRadius: 1,
			buildingRadius: 1,
			detailRadius: 1,
		});

		expect(interest.terrainLandblockIds).toEqual([
			makeOutdoorLandblockId(0, 0),
			makeOutdoorLandblockId(1, 0),
			makeOutdoorLandblockId(0, 1),
			makeOutdoorLandblockId(1, 1),
		]);
	});
});

describe("unionOutdoorSceneLandblockIds", () => {
	it("returns a stable sorted union without making it canonical state", () => {
		expect(unionOutdoorSceneLandblockIds([3, 1], [2, 1])).toEqual([1, 2, 3]);
	});
});
