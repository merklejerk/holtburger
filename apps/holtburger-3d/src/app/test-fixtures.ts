import type { PreparedAssetRecord } from "../lib/assets/types";

export function createPreparedTerrainAsset(
	requestId: string,
	assetId: string,
): PreparedAssetRecord {
	const landblockId = parseLandblockOutdoorAssetId(assetId) ?? 0x0102ffff;

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
			payload: { kind: "landblock-outdoor", landblockId },
		},
		payload: {
			kind: "landblock-outdoor",
			sourceAssetKind: "landblock-outdoor",
			residencyKind: "outdoor-landblock",
			provenance: {
				source: "unknown",
				sourceAssetKind: "landblock-outdoor",
				errorCode: null,
				detail: null,
			},
			landblockId,
			regionId: 0x13000000,
			regionNumber: 1,
			classification: "outdoor",
			terrain: {
				gridSize: 9,
				tileSize: 24,
				vertices: [],
				triangles: [],
				quads: [],
				terrainBvh: {
					coordinateSpace: "landblock-outdoor-terrain-local",
					nodes: [],
					items: [],
				},
				minHeight: 0,
				maxHeight: 24,
				bounds: null,
			},
			statics: [],
			outdoorBvh: null,
			diagnostics: {
				sourceRecords: [],
				omissions: [],
				errors: [],
			},
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}

function parseLandblockOutdoorAssetId(assetId: string): number | null {
	const match = /^landblock\/([0-9a-fA-F]{8})\/outdoor$/.exec(assetId);
	if (!match) {
		return null;
	}
	return Number.parseInt(match[1], 16);
}
