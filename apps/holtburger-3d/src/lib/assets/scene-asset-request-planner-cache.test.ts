import { describe, expect, it } from "vitest";

import { createRuntimeBatch } from "../../app/test-fixtures";
import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	deriveSceneCoverageAssetIds,
	createSceneCoverageRequests,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";

const SINGLE_LANDBLOCK_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 0,
	buildingRadius: 0,
	detailRadius: 0,
};

const ENV_CELL_EXTENDED_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 1,
	buildingRadius: 0,
	detailRadius: 0,
	envCellRadius: 1,
};

const DISTANT_TERRAIN_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 1,
	buildingRadius: 0,
	detailRadius: 0,
	envCellRadius: 0,
};

describe("scene coverage asset ids", () => {
	it("derives outdoor landblock-pack roots without filtering prepared assets", () => {
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
				{},
				SINGLE_LANDBLOCK_OPTIONS,
			),
		).toEqual(["landblock-pack/0102ffff"]);
	});

	it("derives runtime indoor landblock-pack roots", () => {
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
		).toEqual(["landblock-pack/016cffff"]);
	});

	it("derives browser dungeon focus as the parent landblock pack", () => {
		const browserDestination: BrowserLocationSelection = {
			kind: "interior-cell",
			source: "manual",
			label: "0x8a04ffff",
			landblockId: 0x8a04ffff,
			envCellId: 0x8a040100,
		};

		expect(
			deriveSceneCoverageAssetIds(
				createRuntimeBatch(),
				browserDestination,
				{},
				SINGLE_LANDBLOCK_OPTIONS,
			),
		).toEqual(["landblock-pack/8a04ffff"]);
	});

	it("uses one outdoor landblock-pack root instead of portal-derived interior roots", () => {
		expect(
			deriveSceneCoverageAssetIds(
				createRuntimeBatch({
					residency: {
						focusEntityId: null,
						focusLandblockId: 0x016c0001,
						focusCellId: 1,
						focusEnvCellId: null,
						visibleCellIds: [],
						seenOutside: null,
						environmentId: null,
						cellStructureId: null,
						focusLocationLabel: "outdoor",
						indoors: false,
						trackedBodyCount: 0,
					},
				}),
				null,
				{},
				SINGLE_LANDBLOCK_OPTIONS,
			),
		).toEqual(["landblock-pack/016cffff"]);
	});

	it("requests missing outdoor pack roots", () => {
		const requests = createSceneCoverageRequests(
			createRuntimeBatch({
				tick: 7,
				residency: {
					focusEntityId: null,
					focusLandblockId: 0x016c0001,
					focusCellId: 1,
					focusEnvCellId: null,
					visibleCellIds: [],
					seenOutside: null,
					environmentId: null,
					cellStructureId: null,
					focusLocationLabel: "outdoor",
					indoors: false,
					trackedBodyCount: 0,
				},
			}),
			null,
			"streaming",
			{},
			[],
			SINGLE_LANDBLOCK_OPTIONS,
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"landblock-pack/016cffff",
		);
	});

	it("requests summaries for terrain-only outdoor landblocks", () => {
		const requests = createSceneCoverageRequests(
			createRuntimeBatch({
				tick: 7,
				residency: {
					focusEntityId: null,
					focusLandblockId: 0x016c0001,
					focusCellId: 1,
					focusEnvCellId: null,
					visibleCellIds: [],
					seenOutside: null,
					environmentId: null,
					cellStructureId: null,
					focusLocationLabel: "outdoor",
					indoors: false,
					trackedBodyCount: 0,
				},
			}),
			null,
			"streaming",
			{},
			[],
			DISTANT_TERRAIN_OPTIONS,
		);
		const assetIds = requests.map((request) => request.assetId);

		expect(assetIds).toContain("landblock-pack/016cffff");
		expect(assetIds).toContain("landblock-summary/016bffff");
		expect(assetIds).toContain("landblock-summary/016dffff");
		expect(assetIds).not.toContain("landblock-pack/016bffff");
	});

	it("requests landblock packs directly for wider outdoor env-cell coverage", () => {
		expect(
			deriveSceneCoverageAssetIds(
				createRuntimeBatch({
					residency: {
						focusEntityId: null,
						focusLandblockId: 0x016c0001,
						focusCellId: 1,
						focusEnvCellId: null,
						visibleCellIds: [],
						seenOutside: null,
						environmentId: null,
						cellStructureId: null,
						focusLocationLabel: "outdoor",
						indoors: false,
						trackedBodyCount: 0,
					},
				}),
				null,
				{},
				ENV_CELL_EXTENDED_OPTIONS,
			),
		).toContain("landblock-pack/016dffff");
	});

	it("loads landblock packs for env-cell landblocks beyond detail range", () => {
		const assetIds = deriveSceneCoverageAssetIds(
			createRuntimeBatch({
				residency: {
					focusEntityId: null,
					focusLandblockId: 0x016c0001,
					focusCellId: 1,
					focusEnvCellId: null,
					visibleCellIds: [],
					seenOutside: null,
					environmentId: null,
					cellStructureId: null,
					focusLocationLabel: "outdoor",
					indoors: false,
					trackedBodyCount: 0,
				},
			}),
			null,
			{},
			ENV_CELL_EXTENDED_OPTIONS,
		);

		expect(assetIds).toContain("landblock-pack/016dffff");
	});
});
