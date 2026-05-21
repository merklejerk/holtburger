import { describe, expect, it } from "vitest";

import type { PreparedAssetRecord, PreparedPolygonSetBspNode } from "./types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
} from "./structured-interior-coverage";

describe("structured interior coverage", () => {
	it("keeps direct membership exact and sorted", () => {
		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "direct", envCellIds: [0x016c0157, 0x016c0155, 0x016c0155] },
			{},
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155, 0x016c0157],
			truncated: false,
		});
	});

	it("starts landblock closure with only the seed when metadata is missing", () => {
		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "landblock-closure", seedEnvCellIds: [0x016c0155] },
			{},
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155],
			truncated: false,
		});
	});

	it("expands prepared landblock packs to their full env-cell inventory", () => {
		const preparedByAssetId = {
			"landblock-pack/016cffff": createPreparedLandblockPackAsset(
				0x016cffff,
				[0x016c0155, 0x016c0156, 0x016c0157],
			),
		};

		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "landblock-closure", seedEnvCellIds: [0x016c0155] },
			preparedByAssetId,
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155, 0x016c0156, 0x016c0157],
			truncated: false,
		});
	});

	it("uses landblock closure for browser-focused env cells", () => {
		expect(
			deriveBrowserFocusedStructuredInteriorMembershipPolicy(0x8a040100),
		).toEqual({
			kind: "landblock-closure",
			seedEnvCellIds: [0x8a040100],
		});
	});
});

function createPreparedLandblockPackAsset(
	landblockId: number,
	envCellIds: number[],
): PreparedAssetRecord {
	const assetId = `landblock-pack/${landblockId.toString(16).padStart(8, "0")}`;
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
