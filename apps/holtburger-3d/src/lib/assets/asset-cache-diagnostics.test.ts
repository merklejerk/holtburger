import { describe, expect, it } from "vitest";

import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import {
	countPreparedAssetsByKind,
	formatPreparedAssetKindCounts,
} from "./asset-cache-diagnostics";

describe("asset cache diagnostics", () => {
	it("counts prepared assets by payload kind", () => {
		const counts = countPreparedAssetsByKind({
			"landblock-pack/0102ffff": createPreparedTerrainAsset(
				"terrain-a",
				"landblock-pack/0102ffff",
			),
			"landblock-pack/0103ffff": createPreparedTerrainAsset(
				"terrain-b",
				"landblock-pack/0103ffff",
			),
		});

		expect(counts).toEqual({
			total: 2,
			byKind: {
				"landblock-pack": 2,
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
					"landblock-pack": 2,
					"gfx-obj": 1,
				},
			}),
		).toBe("gfx-obj 1, landblock-pack 2");
	});
});
