import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedPolygonSetBspNode,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockTopologyAssetId,
} from "../landblocks";
import { deriveStructuredInteriorSceneModel } from "./structured-interior-scene";

describe("structured interior scene", () => {
	it("renders focused env cells from topology membership and env-cell payloads", () => {
		const destination = parseBrowserLocationInput("016c0155");
		const assetState = createAssetStateWithRecords(
			createPreparedLandblockTopologyAsset(
				0x016cffff,
				[0x016c0155, 0x016c0156, 0x016c0157],
			),
			...[
				createPreparedEnvCellAsset(0x016c0155, 1),
				createPreparedEnvCellAsset(0x016c0156, 2),
				createPreparedEnvCellAsset(0x016c0157, 3),
			],
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

function createAssetStateWithRecords(
	...records: PreparedAssetRecord[]
): AssetChannelState {
	const state = createInitialAssetChannelState();
	return {
		...state,
		preparedByAssetId: Object.fromEntries(
			records.map((record) => [record.request.assetId, record]),
		),
	};
}

function createPreparedLandblockTopologyAsset(
	landblockId: number,
	envCellIds: number[],
): PreparedAssetRecord {
	const assetId = formatLandblockTopologyAssetId(landblockId);
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
			kind: "landblock-topology",
			sourceAssetKind: "landblock-topology",
			residencyKind: "landblock",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "landblock-topology",
				errorCode: null,
				detail: "test",
			},
			landblockId,
			landblockInfoId: (landblockId & 0xffff0000) | 0xfffe,
			classification: "dungeon",
			envCells: envCellIds.map((envCellId) => ({
				memberId: `env-cell/${envCellId.toString(16).padStart(8, "0")}`,
				envCellId,
				assetId: formatEnvCellAssetId(envCellId),
				localPlacement: {
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				},
				visibleEnvCellIds: [],
				restrictionObjectId: null,
				seenOutside: null,
			})),
			portalLinks: [],
			envCellResidencyBvh: {
				coordinateSpace: "landblock-topology-residency",
				nodes: [],
				items: [],
			},
			diagnostics: { sourceRecords: [], errors: [], omissions: [] },
		},
	};
}

function createPreparedEnvCellAsset(
	envCellId: number,
	cellStructureId: number,
): PreparedAssetRecord {
	const assetId = formatEnvCellAssetId(envCellId);
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
			kind: "env-cell",
			sourceAssetKind: "env-cell",
			residencyKind: "interior-cell",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "env-cell",
				errorCode: null,
				detail: "test",
			},
			envCellId,
			environmentId: 0x0d000001,
			cellStructureId,
			surfaces: [],
			portals: [],
			visibleEnvCellIds: [],
			portalApertures: [],
			statics: [],
			renderGeometry: {
				sourceId: cellStructureId,
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
			cellBsp: createLeafBspNode(),
			localBvh: {
				coordinateSpace: "env-cell-local",
				nodes: [],
				items: [],
			},
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
