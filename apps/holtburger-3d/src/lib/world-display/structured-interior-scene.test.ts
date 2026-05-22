import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedPolygonSetBspNode,
} from "../assets/types";
import { formatLandblockPackAssetId } from "../landblocks";
import { deriveStructuredInteriorSceneModel } from "./structured-interior-scene";

describe("structured interior scene", () => {
	it("renders the owning dungeon pack while keeping the destination env cell focused", () => {
		const destination = parseBrowserLocationInput("016c0155");
		const assetState = createAssetStateWithPack(
			createPreparedLandblockPackAsset(
				0x016cffff,
				[0x016c0155, 0x016c0156, 0x016c0157],
			),
		);

		const scene = deriveStructuredInteriorSceneModel(assetState, destination);

		expect(scene.focusEnvCellId).toBe(0x016c0155);
		expect(scene.activeEnvCellIds).toEqual([
			0x016c0155, 0x016c0156, 0x016c0157,
		]);
		expect(scene.cells.map((cell) => cell.envCellId)).toEqual([
			0x016c0155, 0x016c0156, 0x016c0157,
		]);
		expect(scene.cells[0]?.isFocus).toBe(true);
		expect(scene.cells.slice(1).every((cell) => !cell.isFocus)).toBe(true);
	});
});

function createAssetStateWithPack(
	pack: PreparedAssetRecord,
): AssetChannelState {
	const state = createInitialAssetChannelState();
	return {
		...state,
		preparedByAssetId: {
			[pack.request.assetId]: pack,
		},
	};
}

function createPreparedLandblockPackAsset(
	landblockId: number,
	envCellIds: number[],
): PreparedAssetRecord {
	const assetId = formatLandblockPackAssetId(landblockId);
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		preparedAt: "2026-05-20T00:00:00.000Z",
		payload: {
			kind: "landblock-pack",
			sourceAssetKind: "landblock-pack",
			residencyKind: "landblock",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "landblock-pack",
				errorCode: null,
				detail: "test",
			},
			landblockId,
			landblockInfoId: (landblockId & 0xffff0000) | 0xfffe,
			classification: "dungeon",
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: null,
				outdoorStaticInstances: [],
				interiorCells: envCellIds.map((envCellId, index) => ({
					envCellId,
					environmentId: 0x0d000001,
					cellStructureId: index + 1,
					localPlacement: {
						origin: { x: 0, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
					surfaceIds: [],
					portals: [],
					portalApertures: [],
					staticObjectCount: 0,
					cellBsp: createLeafBspNode(),
					renderGeometry: {
						sourceId: index + 1,
						vertexCount: 0,
						triangleCount: 0,
						positions: [],
						normals: [],
						uvs: [],
						triangles: [],
						surfaceIds: [],
						invalidPolygons: [],
						skippedPolygonCount: 0,
						bounds: null,
					},
				})),
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [],
				portalDatIds: [],
				renderableAssetIds: [],
			},
			diagnostics: { sourceRecords: [], errors: [] },
		},
	};
}

function createLeafBspNode(): PreparedPolygonSetBspNode {
	return {
		kind: "leaf",
		index: 0,
		solid: 0,
		sphere: null,
		polyIds: [],
	};
}
