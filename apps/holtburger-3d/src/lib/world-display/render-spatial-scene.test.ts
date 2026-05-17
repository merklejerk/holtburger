import { describe, expect, it } from "vitest";

import type { WorldDebugOverlayModel } from "./debug-overlays";
import {
	DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
	STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
	TERRAIN_SPATIAL_OWNER_KEY,
	deriveDebugOverlaySpatialItems,
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
			id: "terrain:terrain/01020304",
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
				assetId: "terrain/01020304",
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

		expect(pick?.item.id).toBe("terrain:terrain/01020304");
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

function createTerrainScene(): TerrainSceneModel {
	return {
		focusLandblockId: 0x01020304,
		statusText: "",
		cacheText: "",
		dataSourceText: "",
		tiles: [
			{
				assetId: "terrain/01020304",
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
				staticObjectCount: 0,
				cellStructure: null,
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
		missingEnvironmentAssetIds: [],
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
