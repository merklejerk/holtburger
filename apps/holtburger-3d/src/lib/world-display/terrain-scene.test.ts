import { describe, expect, it } from "vitest";

import { createInitialAssetChannelState } from "../assets/types";
import { deriveTerrainSceneModel } from "./terrain-scene";
import type { RuntimeBatchDto } from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 11,
		entities: [],
		residency: {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 1,
		},
	};
}

describe("terrain scene model", () => {
	it("projects cached terrain assets into focus-relative Three.js scene tiles", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/0102ffff": createTerrainAsset(
				"landblock-pack/0102ffff",
				0x0102ffff,
				10,
			),
			"landblock-pack/0103ffff": createTerrainAsset(
				"landblock-pack/0103ffff",
				0x0103ffff,
				9,
			),
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState);

		expect(model.tiles).toHaveLength(2);
		expect(model.tiles[0].isFocus).toBe(true);
		expect(model.tiles[0].assetId).toBe("landblock-pack/0102ffff");
		expect(model.tiles[0].renderChunk).toEqual({
			chunkKey: "landblock/0102ffff",
			chunkLandblockId: 0x0102ffff,
		});
		expect(model.tiles[1].renderChunk).toEqual({
			chunkKey: "landblock/0103ffff",
			chunkLandblockId: 0x0103ffff,
		});
		expect(model.dataSourceText).toMatch(/repo-local CellLandblock/i);
	});

	it("can focus the terrain scene on a browser-selected destination landblock", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/2d5affff": createTerrainAsset(
				"landblock-pack/2d5affff",
				0x2d5affff,
				32,
			),
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState, {
			kind: "outdoor-location",
			label: "29.90S, 65.90W, 0.0Z",
			northSouth: 29.9,
			northSouthHemisphere: "S",
			eastWest: 65.9,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
			landblockId: null,
		});

		expect(model.focusLandblockId).toBe(0x2d5affff);
		expect(model.tiles[0]?.assetId).toBe("landblock-pack/2d5affff");
		expect(model.tiles[0]?.isFocus).toBe(true);
	});

	it("uses the selected coverage radius when filtering cached terrain tiles", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/0102ffff": createTerrainAsset(
				"landblock-pack/0102ffff",
				0x0102ffff,
			),
			"landblock-pack/0104ffff": createTerrainAsset(
				"landblock-pack/0104ffff",
				0x0104ffff,
			),
		};

		const radiusOneModel = deriveTerrainSceneModel(
			createRuntimeBatch(),
			assetState,
			null,
			1,
		);
		const radiusTwoModel = deriveTerrainSceneModel(
			createRuntimeBatch(),
			assetState,
			null,
			2,
		);

		expect(radiusOneModel.tiles.map((tile) => tile.assetId)).toEqual([
			"landblock-pack/0102ffff",
		]);
		expect(radiusTwoModel.tiles.map((tile) => tile.assetId)).toEqual([
			"landblock-pack/0102ffff",
			"landblock-pack/0104ffff",
		]);
	});
});

function createTerrainAsset(
	assetId: string,
	landblockId: number,
	maxHeight = 10,
) {
	return {
		request: {
			requestId: assetId,
			assetId,
			priority: "streaming" as const,
		},
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json" as const,
			payload: {},
		},
		payload: {
			kind: "landblock-pack" as const,
			sourceAssetKind: "landblock-pack" as const,
			residencyKind: "landblock" as const,
			provenance: {
				source: "repo-local-hba" as const,
				sourceAssetKind: "landblock-pack" as const,
				errorCode: null,
				detail: "dats/assets.hba",
			},
			landblockId,
			landblockInfoId: landblockId & 0xffff_fffe,
			classification: "outdoor" as const,
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: {
					landblockId,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight,
				},
				outdoorStaticInstances: [],
				interiorCells: [],
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [],
				portalDatIds: [],
				renderableAssetIds: [],
			},
			diagnostics: {
				sourceRecords: [],
				errors: [],
			},
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}
