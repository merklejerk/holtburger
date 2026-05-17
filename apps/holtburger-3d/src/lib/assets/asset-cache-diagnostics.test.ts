import { describe, expect, it } from "vitest";

import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import {
	countPreparedAssetsByKind,
	formatPreparedAssetKindCounts,
} from "./asset-cache-diagnostics";

describe("asset cache diagnostics", () => {
	it("counts prepared assets by payload kind", () => {
		const counts = countPreparedAssetsByKind({
			"terrain/0102ffff": createPreparedTerrainAsset(
				"terrain-a",
				"terrain/0102ffff",
			),
			"terrain/0103ffff": createPreparedTerrainAsset(
				"terrain-b",
				"terrain/0103ffff",
			),
		});

		expect(counts).toEqual({
			total: 2,
			byKind: {
				"terrain-landblock": 2,
			},
		});
	});

	it("formats empty and non-empty kind counts for debug UI", () => {
		expect(
			formatPreparedAssetKindCounts({
				total: 0,
				byKind: {},
			}),
		).toBe("none");

		expect(
			formatPreparedAssetKindCounts({
				total: 3,
				byKind: {
					"terrain-landblock": 2,
					"gfx-obj": 1,
				},
			}),
		).toBe("gfx-obj 1, terrain-landblock 2");
	});
});
