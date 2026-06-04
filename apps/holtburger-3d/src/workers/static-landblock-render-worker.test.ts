import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../lib/host/contracts";
import {
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
} from "../lib/landblocks";
import type { LandblockRenderPresetWorkerJob } from "../lib/world-display/landblock-render-preset";
import { runStaticLandblockRenderWorkerJob } from "./static-landblock-render-worker";

describe("static landblock render worker", () => {
	it("builds a complete outdoor-with-env-cells preset from worker-local asset lookups", async () => {
		const landblockId = 0xda55ffff;
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockOutdoorAssetId(landblockId),
					createOutdoorPayload(landblockId),
				),
				createResponse(formatTerrainMaterialAssetId(1), createTerrainMaterial()),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
				createResponse(
					formatLandblockTopologyAssetId(landblockId),
					createTopologyPayload(landblockId),
				),
			].map((response) => [response.assetId, response] as const),
		);
		const requestedAssetIds: string[] = [];

		const result = await runStaticLandblockRenderWorkerJob(createJob(), {
			async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
				requestedAssetIds.push(...requests.map((request) => request.assetId));
				return {
					responses: requests.map((request) => {
						const response = lookup.get(request.assetId);
						if (!response) {
							throw new Error(`Missing test response ${request.assetId}.`);
						}
						return response;
					}),
				};
			},
		});

		expect(requestedAssetIds).toContain(formatLandblockOutdoorAssetId(landblockId));
		expect(requestedAssetIds).toContain(formatLandblockTopologyAssetId(landblockId));
		expect(result).toMatchObject({
			type: "landblock-render-preset-built",
			landblockId,
			preset: "outdoor-with-env-cells",
			requestId: "request:worker",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
		});
		expect(result.terrainArtifact?.landblockId).toBe(landblockId);
		expect(result.staticBundleLayers.map((layer) => layer.layerKind)).toEqual([
			"outdoor-buildings",
			"outdoor-detail",
		]);
		expect(
			result.staticBundleLayers.every((layer) => layer.rootAssetIds.length > 0),
		).toBe(true);
	});
});

function createJob(): LandblockRenderPresetWorkerJob {
	return {
		type: "build-landblock-render-preset",
		jobId: "landblock-render-preset:3663069183:outdoor-with-env-cells:request:worker",
		landblockId: 0xda55ffff,
		preset: "outdoor-with-env-cells",
		requestId: "request:worker",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		buildPolicy: {
			atlasLayout: {
				maxTextureSize: 64,
				maxTextureCount: 4,
				gutterPixels: 0,
			},
			terrainMaxLayerEntries: 8,
		},
	};
}

function createResponse(
	assetId: string,
	payload: Record<string, unknown>,
): AssetLookupResponseDto {
	return {
		requestId: `response:${assetId}`,
		assetId,
		payloadKind: "json",
		payload,
	};
}

function createOutdoorPayload(landblockId: number): Record<string, unknown> {
	const bounds = {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 16, y: 16, z: 0 },
	};
	return {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: createProvenance("landblock-outdoor"),
		landblockId,
		regionId: 0x13000000,
		regionNumber: 1,
		classification: "outdoor",
		terrain: {
			gridSize: 2,
			tileSize: 16,
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 16, y: 0, z: 0 },
				{ x: 0, y: 16, z: 0 },
				{ x: 16, y: 16, z: 0 },
			],
			triangles: [
				{
					terrainTriangleId: "terrain/tri/0",
					quadIndex: 0,
					triangleInQuad: 0,
					vertexIndices: [0, 1, 2],
					averageHeight: 0,
					bounds,
				},
				{
					terrainTriangleId: "terrain/tri/1",
					quadIndex: 0,
					triangleInQuad: 1,
					vertexIndices: [2, 1, 3],
					averageHeight: 0,
					bounds,
				},
			],
			quads: [
				{
					terrainQuadId: "terrain/quad/0",
					row: 0,
					col: 0,
					quadIndex: 0,
					sourceTerrainIndices: [0, 1, 2, 3],
					vertexIndices: [0, 1, 2, 3],
					triangleIndices: [0, 1],
					diagonal: "southwest-northeast",
					cornerTerrainCodes: [1, 1, 1, 1],
					pcode: 0x8421,
					averageHeight: 0,
					bounds,
				},
			],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [],
				items: [{ row: 0, col: 0, quadIndex: 0, triangleIndices: [0, 1] }],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds,
		},
		statics: [],
		outdoorBvh: null,
		dependencies: {
			renderableSourceAssetIds: [],
			materialAssetIds: [],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	};
}

function createTopologyPayload(landblockId: number): Record<string, unknown> {
	return {
		kind: "landblock-topology",
		sourceAssetKind: "landblock-topology",
		residencyKind: "landblock",
		provenance: createProvenance("landblock-topology"),
		landblockId,
		landblockInfoId: landblockId,
		classification: "outdoor",
		envCells: [],
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-topology-residency",
			nodes: [],
			items: [],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	};
}

function createTerrainMaterial(): Record<string, unknown> {
	return {
		kind: "terrain-material",
		sourceAssetKind: "terrain-material",
		residencyKind: "unknown",
		provenance: createProvenance("terrain-material"),
		regionNumber: 1,
		materialKind: "tex-merge-table",
		terrainTypes: [],
		terrainAlphaMaps: [],
		roadAlphaMaps: [],
		pcodeEncoding: { terrainCodeBits: 5, roadCodeBits: 2, sizeBitMask: 0 },
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createRegionRenderProfile(): Record<string, unknown> {
	return {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: createProvenance("region-render-profile"),
		regionNumber: 1,
		detailRoles: {
			landscape: null,
			building: null,
			environment: null,
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createProvenance(sourceAssetKind: string): Record<string, unknown> {
	return {
		source: "repo-local-hba",
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}
