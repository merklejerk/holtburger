import { describe, expect, it } from "vitest";

import {
	createPreparedTerrainAsset,
	createRuntimeBatch,
} from "../../app/test-fixtures";
import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	deriveSceneCoverageAssetIds,
	createSceneCoverageRequests,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";
import type { PreparedAssetRecord } from "./types";

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
				{
					"terrain/0102ffff": createPreparedTerrainAsset(
						"terrain",
						"terrain/0102ffff",
					),
				},
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
			kind: "indoor-env-cell",
			source: "manual",
			label: "0x8a04ffff",
			landblockId: 0x8a04ffff,
			envCellId: 0x8a040100,
		};

		expect(
			deriveSceneCoverageAssetIds(
				createRuntimeBatch(),
				browserDestination,
				{
					"indoor-env-cell/8a040100": createPreparedIndoorEnvCellAsset(
						0x8a040100,
						0x0d000001,
						[0x8a040101],
						[0x8a040100, 0x8a040101, 0x8a040102, 0x8a040103],
					),
				},
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
				{
					"outdoor-static-scene/016cffff":
						createPreparedOutdoorStaticSceneAsset(),
					"indoor-env-cell/016c0155": createPreparedIndoorEnvCellAsset(
						0x016c0155,
						0x0d000001,
						[0x016c0156],
						[0x016c0155, 0x016c0156],
					),
					"indoor-env-cell/016c0157": createPreparedIndoorEnvCellAsset(
						0x016c0157,
						0x0d000002,
						[],
					),
				},
				SINGLE_LANDBLOCK_OPTIONS,
			),
		).toEqual(["landblock-pack/016cffff"]);
	});

	it("requests missing outdoor pack roots and not legacy portal interior coverage assets", () => {
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
			{
				"terrain/016cffff": createPreparedTerrainAsset(
					"terrain",
					"terrain/016cffff",
				),
				"outdoor-static-scene/016cffff":
					createPreparedOutdoorStaticSceneAsset(),
				"indoor-env-cell/016c0155": createPreparedIndoorEnvCellAsset(
					0x016c0155,
					0x0d000001,
					[0x016c0156],
					[0x016c0155, 0x016c0156, 0x016c0157],
				),
			},
			["indoor-env-cell/016c0156"],
			SINGLE_LANDBLOCK_OPTIONS,
		);

		expect(requests.map((request) => request.assetId)).not.toContain(
			"environment/0d000001",
		);
		expect(requests.map((request) => request.assetId)).not.toContain(
			"indoor-env-cell/016c0157",
		);
		expect(requests.map((request) => request.assetId)).toContain(
			"landblock-pack/016cffff",
		);
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
				{
					"terrain/016cffff": createPreparedTerrainAsset(
						"terrain",
						"terrain/016cffff",
					),
					"indoor-env-cell/016d0100": createPreparedIndoorEnvCellAsset(
						0x016d0100,
						0x0d000001,
						[],
						[0x016d0100, 0x016d0101],
					),
				},
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

function createPreparedOutdoorStaticSceneAsset(): PreparedAssetRecord {
	return createPreparedAssetRecord("outdoor-static-scene/016cffff", {
		kind: "outdoor-static-scene",
		sourceAssetKind: "outdoor-static-scene",
		residencyKind: "outdoor-landblock",
		provenance: createProvenance("outdoor-static-scene"),
		landblockId: 0x016cffff,
		sceneryInstances: [],
		buildingInstances: [
			{
				instanceId: "building/0",
				owningLandblockId: 0x016cffff,
				sourceDid: 0x02000001,
				sourceAssetId: "setup-model/02000001",
				sourceIndex: 0,
				localPlacement: {
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				},
				numLeaves: 1,
				portals: [
					{
						portalId: "outdoor-portal/00",
						sourceIndex: 0,
						flags: 0,
						otherCellId: 0x016c0155,
						otherPortalId: 0,
						stabList: [0x016c0157, 0x016cffff],
						linkedEnvCellIds: [0x016c0155],
					},
				],
			},
		],
		generatedSceneryInstances: [],
		diagnostics: {
			landblockInfoAvailable: true,
			landblockInfoError: null,
			explicit: createLayerDiagnostics(),
			buildings: createLayerDiagnostics(),
			generated: {
				...createLayerDiagnostics(),
				skippedWeenieObj: 0,
				rejectedFrequency: 0,
				rejectedBounds: 0,
				rejectedBuildingOccupancy: 0,
				rejectedObjectBounds: 0,
				objectBoundsUnavailable: 0,
				rejectedRoad: 0,
				rejectedSlope: 0,
				rejectedOverlap: 0,
			},
		},
	});
}

function createPreparedIndoorEnvCellAsset(
	envCellId: number,
	environmentId: number,
	visibleCellIds: number[],
	landblockEnvCellIds: number[] = [],
): PreparedAssetRecord {
	return createPreparedAssetRecord(
		`indoor-env-cell/${envCellId.toString(16).padStart(8, "0")}`,
		{
			kind: "indoor-env-cell",
			sourceAssetKind: "env-cell",
			residencyKind: "indoor-env-cell",
			provenance: createProvenance("env-cell"),
			debugPresentation: {
				primitive: "env-cell",
				paletteKey: "test",
			},
			envCellId,
			environmentId,
			cellStructureId: 1,
			localPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			visibleCellIds,
			landblockEnvCellIds,
			seenOutside: true,
			surfaceIds: [],
			portalCount: 0,
			portals: [],
			staticObjectCount: 0,
			staticObjects: [],
		},
	);
}

function createPreparedAssetRecord(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: {
			requestId: `request/${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `request/${assetId}`,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-17T00:00:00.000Z",
	};
}

function createProvenance(
	sourceAssetKind: string,
): PreparedAssetRecord["payload"]["provenance"] {
	return {
		source: "unknown",
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}

function createLayerDiagnostics(): {
	attempted: number;
	accepted: number;
	rejectedUnsupportedSource: number;
} {
	return {
		attempted: 1,
		accepted: 1,
		rejectedUnsupportedSource: 0,
	};
}
