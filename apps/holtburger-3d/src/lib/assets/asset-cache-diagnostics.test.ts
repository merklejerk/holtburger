import { describe, expect, it } from "vitest";

import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import {
	countPreparedAssetsByKind,
	formatPreparedAssetKindCounts,
} from "./asset-cache-diagnostics";

describe("asset cache diagnostics", () => {
	it("counts prepared assets by payload kind", () => {
		const counts = countPreparedAssetsByKind({
			"landblock/0102ffff/outdoor": createPreparedTerrainAsset(
				"terrain-a",
				"landblock/0102ffff/outdoor",
			),
			"landblock/0103ffff/outdoor": createPreparedTerrainAsset(
				"terrain-b",
				"landblock/0103ffff/outdoor",
			),
		});

		expect(counts).toEqual({
			total: 2,
			byKind: {
				"landblock-outdoor": 2,
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
					"landblock-outdoor": 2,
					"gfx-obj": 1,
				},
			}),
		).toBe("gfx-obj 1, landblock-outdoor 2");
	});
});
