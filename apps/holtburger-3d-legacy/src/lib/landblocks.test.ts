import { describe, expect, it } from "vitest";

import {
	buildOutdoorCoverageLandblockIds,
	deriveFirstEnvCellId,
	deriveLandblockEnvCellId,
	deriveLandblockEnvCellIds,
	formatEnvCellAssetId,
	formatLandblockLabel,
	formatTerrainMaterialAssetId,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
	parseEnvCellAssetId,
	parseTerrainMaterialAssetId,
} from "./landblocks";

describe("outdoor landblock helpers", () => {
	it("creates and formats unsigned outdoor landblock ids", () => {
		const landblockId = makeOutdoorLandblockId(0xda, 0x55);

		expect(landblockId).toBe(0xda55ffff);
		expect(landblockId).toBeGreaterThan(0);
		expect(formatLandblockLabel(landblockId)).toBe("0xda55ffff");
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
		expect(landblockIds).toContain(0xda54ffff);
		expect(landblockIds).toContain(0xdb56ffff);
		expect(landblockIds.every((landblockId) => landblockId > 0)).toBe(true);
		expect(landblockIds).toHaveLength(9);
	});

	it("derives contiguous env-cell ids from landblock start and count", () => {
		expect(deriveFirstEnvCellId(0xda55ffff, 0)).toBeNull();
		expect(deriveFirstEnvCellId(0xda55ffff, 3)).toBe(0xda550100);
		expect(deriveLandblockEnvCellId(0xda55ffff, 2)).toBe(0xda550102);
		expect(deriveLandblockEnvCellIds(0xda55012e, 3)).toEqual([
			0xda550100, 0xda550101, 0xda550102,
		]);
	});

	it("formats and parses granular scene asset ids", () => {
		expect(formatEnvCellAssetId(0xda550123)).toBe("env-cell/da550123");
		expect(parseEnvCellAssetId("env-cell/da550123")).toBe(0xda550123);
		expect(formatTerrainMaterialAssetId(1)).toBe("terrain-material/1");
		expect(parseTerrainMaterialAssetId("terrain-material/1")).toEqual({
			regionNumber: 1,
		});
		expect(parseTerrainMaterialAssetId("terrain-material/1/123456")).toBeNull();
		expect(
			parseTerrainMaterialAssetId("terrain-material/1/not-a-number"),
		).toBeNull();
	});
});
