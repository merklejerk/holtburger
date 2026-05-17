import { describe, expect, it } from "vitest";

import {
	createPreparedTerrainAsset,
	createRuntimeBatch,
} from "../../app/test-fixtures";
import {
	deriveSceneCoverageAssetIds,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";

const SINGLE_LANDBLOCK_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 0,
	buildingRadius: 0,
	detailRadius: 0,
};

describe("scene coverage asset ids", () => {
	it("derives outdoor terrain and static-scene roots without filtering prepared assets", () => {
		expect(
			deriveSceneCoverageAssetIds(
				createRuntimeBatch({
					residency: {
						focusEntityId: null,
						focusLandblockId: 0x01020003,
						focusCellId: 3,
						focusEnvCellId: null,
						visibleCellIds: [],
						seenOutside: null,
						environmentId: null,
						cellStructureId: null,
						focusLocationLabel: "100.40S, 101.55W, 1.0Z",
						indoors: false,
						trackedBodyCount: 0,
					},
				}),
				null,
				{
					"terrain/0102ffff": createPreparedTerrainAsset(
						"terrain",
						"terrain/0102ffff",
					),
				},
				SINGLE_LANDBLOCK_OPTIONS,
			),
		).toEqual(["outdoor-static-scene/0102ffff", "terrain/0102ffff"]);
	});

	it("derives runtime indoor env-cell and environment roots", () => {
		expect(
			deriveSceneCoverageAssetIds(
				createRuntimeBatch({
					residency: {
						focusEntityId: null,
						focusLandblockId: 0x016c0001,
						focusCellId: 0x0155,
						focusEnvCellId: 0x016c0155,
						visibleCellIds: [0x016c0156],
						seenOutside: false,
						environmentId: 0x0d000001,
						cellStructureId: 1,
						focusLocationLabel: "indoor",
						indoors: true,
						trackedBodyCount: 0,
					},
				}),
				null,
				{},
				SINGLE_LANDBLOCK_OPTIONS,
			),
		).toEqual([
			"environment/0d000001",
			"indoor-env-cell/016c0155",
			"indoor-env-cell/016c0156",
		]);
	});
});
