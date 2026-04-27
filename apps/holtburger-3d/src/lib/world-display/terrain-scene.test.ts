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
				assetKind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				debugPrimitive: "terrain-landblock-mesh",
				paletteKey: "terrain-0102ffff",
				terrainMesh: {
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 10,
				},
				summary: "focus",
				notes: ["Loaded CellLandblock 0x0102FFFF from repo-local dats/assets.hba."],
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
				assetKind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				debugPrimitive: "terrain-landblock-mesh",
				paletteKey: "terrain-0103ffff",
				terrainMesh: {
					landblockId: 0x0103ffff,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 9,
				},
				summary: "east",
				notes: ["Loaded CellLandblock 0x0103FFFF from repo-local dats/assets.hba."],
				preparedAt: "2026-04-26T00:00:00.000Z",
			},
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState);

		expect(model.tiles).toHaveLength(2);
		expect(model.tiles[0].isFocus).toBe(true);
		expect(model.tiles[0].assetId).toBe("terrain/0102ffff");
		expect(model.tiles[1].offsetY).toBe(1);
		expect(model.dataSourceSummary).toMatch(/repo-local CellLandblock/i);
	});

	it("makes preview-placeholder provenance explicit when no live terrain is cached", () => {
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
				assetKind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				debugPrimitive: "terrain-landblock-mesh",
				paletteKey: "terrain-0102ffff",
				terrainMesh: {
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 10,
				},
				summary: "focus",
				notes: ["Browser preview uses a deterministic generated placeholder terrain surface."],
				preparedAt: "2026-04-26T00:00:00.000Z",
			},
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState);

		expect(model.dataSourceSummary).toMatch(/preview placeholder/i);
	});

	it("does not misclassify generated fallback terrain as repo-local just because notes mention unavailable repo-local CellLandblock data", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"terrain/0102ffff": {
				request: {
					requestId: "fallback-focus",
					assetId: "terrain/0102ffff",
					priority: "bootstrap",
				},
				response: {
					requestId: "fallback-focus",
					assetId: "terrain/0102ffff",
					payloadKind: "json",
					payload: {},
				},
				assetKind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				debugPrimitive: "terrain-landblock-mesh",
				paletteKey: "terrain-0102ffff",
				terrainMesh: {
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 10,
				},
				summary: "focus",
				notes: [
					"Fell back to an app-local generated preview placeholder terrain surface because repo-local CellLandblock data was unavailable.",
					"This generated preview placeholder keeps the Phase 9 world browser visible when repo-local content fixtures are missing, but it is not a replacement for real CellLandblock data.",
				],
				preparedAt: "2026-04-26T00:00:00.000Z",
			},
		};

		const model = deriveTerrainSceneModel(createRuntimeBatch(), assetState);

		expect(model.dataSourceSummary).toMatch(/preview placeholder/i);
		expect(model.dataSourceSummary).not.toMatch(/repo-local CellLandblock/i);
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
				assetKind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				debugPrimitive: "terrain-landblock-mesh",
				paletteKey: "terrain-2d5affff",
				terrainMesh: {
					landblockId: 0x2d5affff,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 32,
				},
				summary: "destination",
				notes: ["Loaded CellLandblock 0x2D5AFFFF from repo-local dats/assets.hba."],
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