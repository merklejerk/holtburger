import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
} from "../assets/types";
import type { WorldDebugOverlayModel } from "./debug-overlays";
import {
	DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
	LANDBLOCK_PACK_SPATIAL_OWNER_KEY,
	STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
	TERRAIN_SPATIAL_OWNER_KEY,
	deriveDebugOverlaySpatialItems,
	deriveLandblockPackRenderChunkPlacements,
	deriveLandblockPackSpatialItems,
	deriveLandblockPackSpatialOwnerKey,
	deriveStructuredInteriorSpatialItems,
	deriveTerrainSpatialItems,
} from "./render-spatial-scene";
import { createLinearRenderSpatialIndex } from "./render-spatial-index";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import {
	deriveStructuredCellRenderChunk,
	deriveTerrainTileRenderChunk,
} from "./render-chunks";

describe("deriveTerrainSpatialItems", () => {
	it("derives terrain tile bounds in chunk-local space", () => {
		const items = deriveTerrainSpatialItems(createTerrainScene());

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: "terrain:landblock-pack/0102ffff",
			kind: "terrain",
			ownerKey: TERRAIN_SPATIAL_OWNER_KEY,
			chunkKey: "landblock/0102ffff",
			broadphaseBounds: {
				min: { x: 0, y: -2, z: -6 },
				max: { x: 4, y: 8, z: 0 },
			},
			metadata: {
				kind: "terrain",
				landblockId: 0x01020304,
				assetId: "landblock-pack/0102ffff",
				terrainQuad: null,
			},
		});
	});

	it("feeds chunk-local terrain items into renderer-local index picks", () => {
		const index = createLinearRenderSpatialIndex();
		index.replaceChunkTransforms([
			{
				chunkKey: "landblock/0102ffff",
				chunkLandblockId: 0x0102ffff,
				offset: { x: 10, y: 0, z: -20 },
			},
		]);
		index.replaceOwnerItems(
			TERRAIN_SPATIAL_OWNER_KEY,
			deriveTerrainSpatialItems(createTerrainScene()),
		);

		const pick = index.pickRay(
			{
				origin: { x: 12, y: 0, z: -30 },
				direction: { x: 0, y: 0, z: 1 },
			},
			new Set(["terrain"]),
		);

		expect(pick?.item.id).toBe("terrain:landblock-pack/0102ffff");
		expect(pick?.point).toEqual({ x: 12, y: 0, z: -26 });
		expect(pick?.distance).toBe(4);
	});
});

describe("deriveStructuredInteriorSpatialItems", () => {
	it("derives structured cell bounds independently of debug overlay toggles", () => {
		const items = deriveStructuredInteriorSpatialItems(
			createStructuredInteriorScene(),
		);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: "structured-cell:cell-1",
			kind: "structured-cell",
			ownerKey: STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
			chunkKey: "landblock/016cffff",
			metadata: {
				kind: "structured-cell",
				envCellId: 0x016c0155,
				renderKey: "cell-1",
			},
		});
	});
});

describe("deriveDebugOverlaySpatialItems", () => {
	it("derives visible debug diagnostics from scene model data", () => {
		const items = deriveDebugOverlaySpatialItems(createDebugOverlayScene());

		expect(items.map((item) => item.kind)).toEqual([
			"structured-cell",
			"portal",
		]);
		expect(items[0]).toMatchObject({
			id: "debug-cell:cell-1",
			ownerKey: DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			chunkKey: "landblock/016cffff",
			metadata: {
				kind: "structured-cell",
				envCellId: 0x016c0155,
			},
		});
		expect(items[1]).toMatchObject({
			id: "portal:portal-1",
			ownerKey: DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			chunkKey: "landblock/016cffff",
			metadata: {
				kind: "portal",
				portalId: "portal-1",
				sourceEnvCellId: 0x016c0155,
				targetEnvCellId: 0x016c0156,
			},
		});
	});

	it("does not derive hidden debug raycast targets", () => {
		const items = deriveDebugOverlaySpatialItems({
			...createDebugOverlayScene(),
			showCellIndicators: false,
			showPortalPolygons: false,
		});

		expect(items).toEqual([]);
	});
});

describe("deriveLandblockPackSpatialItems", () => {
	it("adapts pack spatial items into render spatial index items", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/0102ffff": {
				request: {
					requestId: "pack",
					assetId: "landblock-pack/0102ffff",
					priority: "streaming",
				},
				response: {
					requestId: "pack",
					assetId: "landblock-pack/0102ffff",
					payloadKind: "json",
					payload: {},
				},
				payload: {
					kind: "landblock-pack",
					sourceAssetKind: "landblock-pack",
					residencyKind: "landblock",
					landblockId: 0x0102ffff,
					landblockInfoId: 0x0102fffe,
					classification: "outdoor",
					sourceFacts: {
						buildings: [],
					},
					prepared: {
						terrainMesh: null,
						outdoorStaticInstances: [],
						interiorCells: [],
						staticMeshes: [],
						spatialItems: [
							{
								id: "pack/static/0",
								kind: "outdoor-static",
								ownerId: 0x0102ffff,
								sourceAssetId: "gfx-obj/01000001",
								bounds: {
									min: { x: 1, y: 2, z: 3 },
									max: { x: 4, y: 5, z: 6 },
								},
								metadata: { kind: "none" },
							},
						],
						staticLandblockBvh: {
							coordinateSpace: "landblock-render-local",
							landblockId: 0x0102ffff,
							scope: "static-landblock",
							nodes: [
								{
									bounds: {
										min: { x: 1, y: 2, z: 3 },
										max: { x: 4, y: 5, z: 6 },
									},
									left: null,
									right: null,
									itemIndices: [0],
									kindMask: 2,
								},
							],
						},
					},
					dependencies: {
						cellDatIds: [],
						portalDatIds: [],
						renderableAssetIds: [],
					},
					diagnostics: { sourceRecords: [], errors: [] },
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "landblock-pack",
						errorCode: null,
						detail: "test",
					},
				},
				preparedAt: "2026-05-20T00:00:00.000Z",
			},
		};

		const items = deriveLandblockPackSpatialItems(assetState);

		expect(items).toEqual([
			expect.objectContaining({
				id: "landblock-pack:pack/static/0",
				kind: "outdoor-static",
				ownerKey: deriveLandblockPackSpatialOwnerKey(0x0102ffff),
				chunkKey: "landblock/0102ffff",
				broadphaseBounds: {
					min: { x: 1, y: 2, z: 3 },
					max: { x: 4, y: 5, z: 6 },
				},
				metadata: {
					kind: "landblock-pack-spatial",
					spatialKind: "outdoor-static",
					itemId: "pack/static/0",
					landblockId: 0x0102ffff,
					ownerId: 0x0102ffff,
					sourceAssetId: "gfx-obj/01000001",
				},
			}),
		]);
	});

	it("preserves pack terrain quad metadata for terrain narrowphase", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/0102ffff": {
				request: {
					requestId: "pack",
					assetId: "landblock-pack/0102ffff",
					priority: "streaming",
				},
				response: {
					requestId: "pack",
					assetId: "landblock-pack/0102ffff",
					payloadKind: "json",
					payload: {},
				},
				payload: {
					kind: "landblock-pack",
					sourceAssetKind: "landblock-pack",
					residencyKind: "landblock",
					landblockId: 0x0102ffff,
					landblockInfoId: 0x0102fffe,
					classification: "outdoor",
					sourceFacts: {
						buildings: [],
					},
					prepared: {
						terrainMesh: null,
						outdoorStaticInstances: [],
						interiorCells: [],
						staticMeshes: [],
						spatialItems: [
							{
								id: "landblock-pack/0102ffff/spatial/terrain-quad/03/04",
								kind: "terrain",
								ownerId: 0x0102ffff,
								sourceAssetId: null,
								bounds: {
									min: { x: 96, y: 1, z: -96 },
									max: { x: 120, y: 8, z: -72 },
								},
								metadata: {
									kind: "terrain-quad",
									row: 3,
									col: 4,
									quadIndex: 28,
									triangleIndices: [56, 57],
								},
							},
						],
						staticLandblockBvh: {
							coordinateSpace: "landblock-render-local",
							landblockId: 0x0102ffff,
							scope: "static-landblock",
							nodes: [
								{
									bounds: {
										min: { x: 96, y: 1, z: -96 },
										max: { x: 120, y: 8, z: -72 },
									},
									left: null,
									right: null,
									itemIndices: [0],
									kindMask: 1,
								},
							],
						},
					},
					dependencies: {
						cellDatIds: [],
						portalDatIds: [],
						renderableAssetIds: [],
					},
					diagnostics: { sourceRecords: [], errors: [] },
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "landblock-pack",
						errorCode: null,
						detail: "test",
					},
				},
				preparedAt: "2026-05-20T00:00:00.000Z",
			},
		};

		const items = deriveLandblockPackSpatialItems(assetState);

		expect(items[0]?.metadata).toEqual({
			kind: "terrain",
			landblockId: 0x0102ffff,
			assetId: "landblock-pack/0102ffff/spatial/terrain-quad/03/04",
			terrainQuad: {
				row: 3,
				col: 4,
				quadIndex: 28,
				triangleIndices: [56, 57],
			},
		});
	});

	it("derives chunk placements for prepared pack spatial items before rendered tiles exist", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/d853ffff": createPreparedLandblockPackAsset(0xd853ffff),
		};
		const spatialItems = deriveLandblockPackSpatialItems(assetState);
		const chunkPlacements =
			deriveLandblockPackRenderChunkPlacements(assetState);
		const index = createLinearRenderSpatialIndex();

		index.replaceChunkTransforms(
			chunkPlacements.map((chunk) => ({
				...chunk,
				offset: { x: 0, y: 0, z: 0 },
			})),
		);

		expect(() =>
			index.replaceOwnerItems(
				spatialItems[0]?.ownerKey ?? LANDBLOCK_PACK_SPATIAL_OWNER_KEY,
				spatialItems,
			),
		).not.toThrow();
		expect(chunkPlacements).toEqual([
			{
				chunkKey: "landblock/d853ffff",
				chunkLandblockId: 0xd853ffff,
			},
		]);
	});
});

function createPreparedLandblockPackAsset(
	landblockId: number,
): PreparedAssetRecord {
	return {
		request: {
			requestId: "pack",
			assetId: `landblock-pack/${landblockId.toString(16).padStart(8, "0")}`,
			priority: "streaming",
		},
		response: {
			requestId: "pack",
			assetId: `landblock-pack/${landblockId.toString(16).padStart(8, "0")}`,
			payloadKind: "json",
			payload: {},
		},
		payload: {
			kind: "landblock-pack",
			sourceAssetKind: "landblock-pack",
			residencyKind: "landblock",
			landblockId,
			landblockInfoId: (landblockId & 0xffff0000) | 0xfffe,
			classification: "outdoor",
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: null,
				outdoorStaticInstances: [],
				interiorCells: [],
				staticMeshes: [],
				spatialItems: [
					{
						id: `landblock-pack/${landblockId.toString(16).padStart(8, "0")}/spatial/terrain-quad/07/00`,
						kind: "terrain",
						ownerId: landblockId,
						sourceAssetId: null,
						bounds: {
							min: { x: 0, y: 0, z: -192 },
							max: { x: 24, y: 8, z: -168 },
						},
						metadata: {
							kind: "terrain-quad",
							row: 7,
							col: 0,
							quadIndex: 56,
							triangleIndices: [112, 113],
						},
					},
				],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [],
				portalDatIds: [],
				renderableAssetIds: [],
			},
			diagnostics: { sourceRecords: [], errors: [] },
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "landblock-pack",
				errorCode: null,
				detail: "test",
			},
		},
		preparedAt: "2026-05-20T00:00:00.000Z",
	};
}

function createTerrainScene(): TerrainSceneModel {
	return {
		focusLandblockId: 0x01020304,
		statusText: "",
		cacheText: "",
		dataSourceText: "",
		tiles: [
			{
				assetId: "landblock-pack/0102ffff",
				landblockId: 0x01020304,
				renderChunk: deriveTerrainTileRenderChunk(0x01020304),
				label: "01020304",
				isFocus: true,
				chunkLocalOffset: { x: 0, y: 0, z: 0 },
				mesh: {
					landblockId: 0x01020304,
					gridSize: 2,
					tileSize: 4,
					minHeight: -2,
					maxHeight: 8,
					vertices: [
						{ x: 0, y: 0, z: -2 },
						{ x: 4, y: 6, z: 8 },
					],
					triangles: [],
				},
				dataSource: "repo-local-cell-landblock",
			},
		],
	};
}

function createStructuredInteriorScene(): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: 0x016c0155,
		activeEnvCellIds: [0x016c0155],
		cells: [
			{
				renderKey: "cell-1",
				envCellId: 0x016c0155,
				renderChunk: deriveStructuredCellRenderChunk(0x016c0155),
				environmentId: 0x0d000001,
				cellStructureId: 1,
				isFocus: true,
				chunkLocalPlacement: identityPlacement(),
				surfaceIds: [],
				portalCount: 0,
				portals: [],
				portalApertures: [],
				staticObjectCount: 0,
				cellStructure: null,
				cellBsp: null,
				renderGeometry: {
					sourceId: 1,
					vertexCount: 0,
					triangleCount: 0,
					positions: [],
					normals: [],
					uvs: [],
					triangles: [],
					surfaceIds: [],
					bounds: {
						min: { x: -1, y: -1, z: -1 },
						max: { x: 1, y: 1, z: 1 },
					},
				},
				debugColorKey: "cell-1",
			},
		],
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "",
		cacheText: "",
	};
}

function createDebugOverlayScene(): WorldDebugOverlayModel {
	return {
		showPortalPolygons: true,
		showCellIndicators: true,
		highlightPortalTargets: true,
		cells: [
			{
				envCellId: 0x016c0155,
				renderChunk: deriveStructuredCellRenderChunk(0x016c0155),
				renderKey: "cell-1",
				label: "0155",
				colorKey: "cell-1",
				isFocus: true,
				isSelected: false,
				chunkLocalPlacement: identityPlacement(),
				bounds: {
					min: { x: -1, y: -1, z: -1 },
					max: { x: 1, y: 1, z: 1 },
				},
			},
		],
		portals: [
			{
				portalId: "portal-1",
				sourceEnvCellId: 0x016c0155,
				renderChunk: deriveStructuredCellRenderChunk(0x016c0155),
				targetEnvCellId: 0x016c0156,
				targetStatus: "loaded-visible",
				polygonId: 7,
				otherPortalId: 8,
				flags: 9,
				isSelected: false,
				chunkLocalPlacement: identityPlacement(),
				points: [
					{ x: 0, y: 0, z: 0 },
					{ x: 1, y: 0, z: 0 },
					{ x: 0, y: 1, z: 0 },
				],
				colorKey: "portal-1",
			},
		],
		diagnostics: {
			cellCount: 1,
			portalCount: 1,
			missingPortalPolygonCount: 0,
			knownTargetCount: 1,
			loadedTargetCount: 1,
		},
	};
}

function identityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
