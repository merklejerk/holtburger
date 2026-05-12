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
			"terrain/0102ffff": {
				request: {
					requestId: "bootstrap-focus",
					assetId: "terrain/0102ffff",
					priority: "bootstrap",
				},
				response: {
					requestId: "bootstrap-focus",
					assetId: "terrain/0102ffff",
					payloadKind: "json",
					payload: {},
				},
				payload: {
					kind: "terrain-landblock",
					sourceAssetKind: "cell-landblock",
					residencyKind: "outdoor-landblock",
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: "dats/assets.hba",
					},
					debugPresentation: {
						primitive: "terrain-landblock-mesh",
						paletteKey: "terrain-0102ffff",
					},
					terrainMesh: {
						landblockId: 0x0102ffff,
						gridSize: 9,
						tileSize: 24,
						vertices: [],
						triangles: [],
						minHeight: 0,
						maxHeight: 10,
					},
				},
				preparedAt: "2026-04-26T00:00:00.000Z",
			},
			"terrain/0103ffff": {
				request: {
					requestId: "streaming-east",
					assetId: "terrain/0103ffff",
					priority: "streaming",
				},
				response: {
					requestId: "streaming-east",
					assetId: "terrain/0103ffff",
					payloadKind: "json",
					payload: {},
				},
				payload: {
					kind: "terrain-landblock",
					sourceAssetKind: "cell-landblock",
					residencyKind: "outdoor-landblock",
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: "dats/assets.hba",
					},
					debugPresentation: {
						primitive: "terrain-landblock-mesh",
						paletteKey: "terrain-0103ffff",
					},
					terrainMesh: {
						landblockId: 0x0103ffff,
						gridSize: 9,
						tileSize: 24,
						vertices: [],
						triangles: [],
						minHeight: 0,
						maxHeight: 9,
					},
				},
				preparedAt: "2026-04-26T00:00:00.000Z",
			},
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState);

		expect(model.tiles).toHaveLength(2);
		expect(model.tiles[0].isFocus).toBe(true);
		expect(model.tiles[0].assetId).toBe("terrain/0102ffff");
		expect(model.tiles[1].offsetY).toBe(1);
		expect(model.dataSourceText).toMatch(/repo-local CellLandblock/i);
	});

	it("can focus the terrain scene on a browser-selected destination landblock", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"terrain/2d5affff": {
				request: {
					requestId: "bootstrap-destination",
					assetId: "terrain/2d5affff",
					priority: "bootstrap",
				},
				response: {
					requestId: "bootstrap-destination",
					assetId: "terrain/2d5affff",
					payloadKind: "json",
					payload: {},
				},
				payload: {
					kind: "terrain-landblock",
					sourceAssetKind: "cell-landblock",
					residencyKind: "outdoor-landblock",
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: "dats/assets.hba",
					},
					debugPresentation: {
						primitive: "terrain-landblock-mesh",
						paletteKey: "terrain-2d5affff",
					},
					terrainMesh: {
						landblockId: 0x2d5affff,
						gridSize: 9,
						tileSize: 24,
						vertices: [],
						triangles: [],
						minHeight: 0,
						maxHeight: 32,
					},
				},
				preparedAt: "2026-04-26T00:00:00.000Z",
			},
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState, {
			label: "29.90S, 65.90W, 0.0Z",
			northSouth: 29.9,
			northSouthHemisphere: "S",
			eastWest: 65.9,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
		});

		expect(model.focusLandblockId).toBe(0x2d5affff);
		expect(model.tiles[0]?.assetId).toBe("terrain/2d5affff");
		expect(model.tiles[0]?.isFocus).toBe(true);
	});
});
