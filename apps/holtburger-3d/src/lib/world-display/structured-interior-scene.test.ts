import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedEnvCellPayload,
	type PreparedPolygonSetBspNode,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockTopologyAssetId,
} from "../landblocks";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import {
	deriveStructuredInteriorSceneModel,
	deriveStructuredInteriorSceneModelFromLandblockArtifacts,
} from "./structured-interior-scene";

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
		expect(scene.cells[0]?.chunkLocalPlacement.origin).toEqual({
			x: 1,
			y: 2,
			z: 3,
		});
		expect(scene.cells.slice(1).every((cell) => !cell.isFocus)).toBe(true);
	});

	it("renders structured interiors from resident worker detailed artifacts", () => {
		const destination = parseBrowserLocationInput("016c0155");
		const envCell = createPreparedEnvCellAsset(0x016c0155, 0x0d000001)
			.payload as PreparedEnvCellPayload;
		const scene = deriveStructuredInteriorSceneModelFromLandblockArtifacts(
			createArtifactSnapshot([
				createDetailedProductResult(0x016cffff, "outdoor-env-cells", envCell),
			]),
			destination,
			{ envCellIds: [0x016c0155], truncated: false },
		);

		expect(scene?.focusEnvCellId).toBe(0x016c0155);
		expect(scene?.activeEnvCellIds).toEqual([0x016c0155]);
		expect(scene?.cells).toHaveLength(1);
		expect(scene?.cells[0]?.envCellId).toBe(0x016c0155);
		expect(scene?.cells[0]?.chunkLocalPlacement.origin).toEqual({
			x: 0x0d000001,
			y: 0x0d000002,
			z: 0x0d000003,
		});
		expect(scene?.cells[0]?.cellBsp).toBe(envCell.cellBsp);
		expect(scene?.cells[0]?.renderGeometry).toBe(envCell.renderGeometry);
		expect(scene?.cacheText).toContain("resident landblock detailed artifact");
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
			localPlacement: {
				origin: {
					x: cellStructureId,
					y: cellStructureId + 1,
					z: cellStructureId + 2,
				},
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
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

function createArtifactSnapshot(
	artifacts: readonly LandblockRenderProductWorkerResult[],
): StaticLandblockRenderArtifactStoreSnapshot {
	return {
		artifacts,
		desiredCount: artifacts.length,
		residentCount: artifacts.length,
		inFlightCount: 0,
		staleResultCount: 0,
		committedResultCount: artifacts.length,
		evictedResultCount: 0,
		errorCount: 0,
		latestDesiredIdentityKeys: [],
	};
}

function createDetailedProductResult(
	landblockId: number,
	product: "outdoor-env-cells" | "dungeon-env-cells",
	envCell: PreparedEnvCellPayload,
): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId: `job:${landblockId}:${product}`,
		landblockId,
		product,
		requestId: "request",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				artifactKind: "detailed-landblock",
				key: `detailed:${landblockId}:${product}`,
				landblockId,
				product,
				requestId: "request",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "pages:v1",
				selectedEnvCellIds: [envCell.envCellId],
				structuredInteriorCells: [
					{
						key: `structured-interior-cell:${envCell.envCellId}`,
						envCellId: envCell.envCellId,
						landblockId,
						regionNumber: envCell.regionNumber,
						environmentId: envCell.environmentId,
						cellStructureId: envCell.cellStructureId,
						renderChunk: {
							chunkKey: `structured-cell:${envCell.envCellId}`,
							chunkLandblockId: landblockId,
							chunkLocalOffset: { x: 0, y: 0, z: 0 },
						},
						localPlacement: envCell.localPlacement,
						surfaceIds: [],
						portals: [],
						portalApertureKeys: [],
						staticObjectCount: 0,
						cellBsp: envCell.cellBsp,
						renderGeometry: envCell.renderGeometry,
					},
				],
				cellStructureMetadata: [],
				portalLinks: [],
				portalApertures: [],
				visibility: {
					objectVisibilityRecords: [],
					cellVisibilityRecords: [],
				},
				spatial: {
					envCellResidencyBvh: {
						coordinateSpace: "landblock-topology-residency",
						nodes: [],
						items: [],
					},
					envCellLocalBvhs: [],
				},
			},
		],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}
