import { describe, expect, it } from "vitest";

import {
	describeBrowserDestinationIdentity,
	parseBrowserLocationInput,
} from "../../app/browser-mode";
import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import { formatLandblockPackAssetId } from "../landblocks";
import {
	createSceneCoverageRequests,
	deriveSceneCoverageAssetIds,
} from "./scene-asset-request-planner";
import type { PreparedAssetRecord, PreparedLandblockStaticMesh } from "./types";

describe("scene asset request planner", () => {
	it("derives outdoor browser coverage from destination and radii", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 7,
				browserDestination: destination,
				preparedByAssetId: {},
				options: {
					terrainRadius: 1,
					buildingRadius: 0,
					detailRadius: 0,
					envCellRadius: 0,
				},
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"landblock-pack/da55ffff",
			"landblock-summary/d954ffff",
			"landblock-summary/d955ffff",
			"landblock-summary/d956ffff",
			"landblock-summary/da54ffff",
			"landblock-summary/da56ffff",
			"landblock-summary/db54ffff",
			"landblock-summary/db55ffff",
			"landblock-summary/db56ffff",
		]);
		expect(requests[0]?.requestId).toBe(
			"streaming-7-outdoor-landblock-da55ffff-pack-landblock-pack/da55ffff",
		);
	});

	it("keeps destination identity stable across source labels", () => {
		const manualDestination = parseBrowserLocationInput(
			"da55",
			"manual",
			"outdoor",
		);
		const pickedDestination = parseBrowserLocationInput(
			"da55",
			"landblock-pick",
			"outdoor",
		);

		expect(describeBrowserDestinationIdentity(manualDestination)).toBe(
			describeBrowserDestinationIdentity(pickedDestination),
		);
	});

	it("derives dungeon browser coverage from the owning landblock pack", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 3,
				browserDestination: destination,
				preparedByAssetId: {},
				options: {
					terrainRadius: 2,
					buildingRadius: 1,
					detailRadius: 1,
					envCellRadius: 1,
				},
			},
			"bootstrap",
		);

		expect(requests).toEqual([
			{
				requestId:
					"bootstrap-3-interior-cell-016c0155-landblock-016cffff-pack-landblock-pack/016cffff",
				assetId: "landblock-pack/016cffff",
				priority: "bootstrap",
			},
		]);
		expect(deriveSceneCoverageAssetIds(destination, {})).toEqual([
			"landblock-pack/016cffff",
		]);
	});

	it("requests dungeon static dependencies from prepared pack cells", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedPack = createPreparedDungeonPackWithIndoorStatic(
			0x016cffff,
			0x016c0155,
			"gfx-obj/02000001",
		);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 4,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedPack.request.assetId]: preparedPack,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests).toEqual([
			{
				requestId:
					"streaming-4-interior-cell-016c0155-landblock-016cffff-indoor-static-renderable-gfx-obj/02000001",
				assetId: "gfx-obj/02000001",
				priority: "streaming",
			},
		]);
	});
});

function createPreparedDungeonPackWithIndoorStatic(
	landblockId: number,
	envCellId: number,
	gfxObjAssetId: string,
): PreparedAssetRecord {
	const asset = createPreparedTerrainAsset(
		"fixture-dungeon-pack",
		formatLandblockPackAssetId(landblockId),
	);
	if (asset.payload.kind !== "landblock-pack") {
		throw new Error("Expected test fixture to create a landblock pack.");
	}

	asset.payload.classification = "dungeon";
	asset.payload.prepared.staticMeshes = [
		createPreparedIndoorStaticMesh(landblockId, envCellId, gfxObjAssetId),
	];
	asset.payload.dependencies.renderableAssetIds = [gfxObjAssetId];
	return asset;
}

function createPreparedIndoorStaticMesh(
	landblockId: number,
	envCellId: number,
	gfxObjAssetId: string,
): PreparedLandblockStaticMesh {
	return {
		instanceId: "fixture-indoor-static",
		kind: "indoor-static",
		owningLandblockId: landblockId,
		owningEnvCellId: envCellId,
		sourceDid: 0x02000001,
		sourceAssetId: "setup-model/02000001",
		sourceIndex: 0,
		localPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		sourceScale: { x: 1, y: 1, z: 1 },
		partIndex: 0,
		gfxObjId: 0x02000001,
		gfxObjAssetId,
		partPlacements: [],
		partScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
	};
}
