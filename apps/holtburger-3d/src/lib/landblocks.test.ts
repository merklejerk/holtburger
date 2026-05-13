import { describe, expect, it } from "vitest";

import {
	buildOutdoorCoverageLandblockIds,
	formatLandblockLabel,
	formatLandblockStaticsAssetId,
	formatTerrainAssetId,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "./landblocks";

describe("outdoor landblock helpers", () => {
	it("creates and formats unsigned outdoor landblock ids", () => {
		const landblockId = makeOutdoorLandblockId(0xda, 0x55);

		expect(landblockId).toBe(0xda55ffff);
		expect(landblockId).toBeGreaterThan(0);
		expect(formatLandblockLabel(landblockId)).toBe("0xda55ffff");
		expect(formatTerrainAssetId(landblockId)).toBe("terrain/da55ffff");
		expect(formatLandblockStaticsAssetId(landblockId)).toBe(
			"landblock-statics/da55ffff",
		);
	});

	it("normalizes raw landblock ids to outdoor xxyyffff ids", () => {
		expect(normalizeOutdoorLandblockId(0xda550123)).toBe(0xda55ffff);
		expect(getOutdoorLandblockCoords(0xda550123)).toEqual({
			x: 0xda,
			y: 0x55,
		});
	});

	it("builds an ordered unsigned coverage ring around a focus landblock", () => {
		const landblockIds = buildOutdoorCoverageLandblockIds(0xda55ffff, 1);

		expect(landblockIds[0]).toBe(0xda55ffff);
		expect(landblockIds).toContain(0xdb56ffff);
		expect(landblockIds.every((landblockId) => landblockId > 0)).toBe(true);
		expect(landblockIds).toHaveLength(9);
	});
});
