import type { PreparedAssetRecord } from "../lib/assets/types";

export function createPreparedTerrainAsset(
	requestId: string,
	assetId: string,
): PreparedAssetRecord {
	const landblockId = parseLandblockPackAssetId(assetId) ?? 0x0102ffff;

	return {
		request: {
			requestId,
			assetId,
			priority: "bootstrap",
		},
		response: {
			requestId,
			assetId,
			payloadKind: "json",
			payload: { kind: "landblock-pack", landblockId },
		},
		payload: {
			kind: "landblock-pack",
			sourceAssetKind: "landblock-pack",
			residencyKind: "landblock",
			provenance: {
				source: "unknown",
				sourceAssetKind: "landblock-pack",
				errorCode: null,
				detail: null,
			},
			landblockId,
			landblockInfoId: landblockId & 0xffff_fffe,
			classification: "outdoor",
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
					maxHeight: 24,
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

function parseLandblockPackAssetId(assetId: string): number | null {
	const match = /^landblock-pack\/([0-9a-fA-F]{8})$/.exec(assetId);
	if (!match) {
		return null;
	}
	return Number.parseInt(match[1], 16);
}
