import { describe, expect, it } from "vitest";

import type { PreparedTerrainMesh } from "../assets/types";
import type {
	LandblockRenderProductWorkerResult,
	StaticLandblockProductKey,
} from "./landblock-render-product";
import { deriveRenderChunkKeyFromLandblockId } from "./render-chunks";
import { createStaticLandblockProductMetadataStore } from "./static-landblock-product-metadata";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import type { TerrainMaterialResourcePlan } from "./terrain-materials";

describe("static landblock product metadata", () => {
	it("commits and evicts product-owned terrain spatial facts", () => {
		const store = createStaticLandblockProductMetadataStore();
		const result = createTerrainProductResult();
		store.updateRenderChunkTransforms([
			{
				chunkKey: deriveRenderChunkKeyFromLandblockId(result.landblockId),
				chunkLandblockId: result.landblockId,
				offset: { x: 0, y: 0, z: 0 },
			},
		]);

		store.commitProduct(result);

		expect(store.productCount()).toBe(1);
		expect(store.spatialItemCount()).toBe(1);
		expect(
			store.spatialQuery
				.queryFrustum(
					{
						planes: [],
					},
					new Set(["terrain"]),
				)
				.map((item) => item.metadata),
		).toEqual([
			{
				kind: "terrain",
				landblockId: 0xda55ffff,
				assetId: "landblock/da55ffff/outdoor",
				terrainQuad: null,
			},
		]);

		store.evictProduct(createProductKey(result));

		expect(store.productCount()).toBe(0);
		expect(store.spatialItemCount()).toBe(0);
	});
});

function createTerrainProductResult(): LandblockRenderProductWorkerResult {
	const landblockId = 0xda55ffff;
	return {
		type: "landblock-render-product-built",
		jobId:
			"landblock-render-product:3663069183:outdoor-terrain:build:v1:texture-pages:v1",
		landblockId,
		product: "outdoor-terrain",
		requestId: "request:test",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		artifacts: [createTerrainArtifact(landblockId)],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createProductKey(
	result: LandblockRenderProductWorkerResult,
): StaticLandblockProductKey {
	return {
		landblockId: result.landblockId,
		product: result.product,
		buildPolicyRevision: result.buildPolicyRevision,
		texturePagePolicyRevision: result.texturePagePolicyRevision,
	};
}

function createTerrainArtifact(
	landblockId: number,
): LandblockTerrainRenderArtifact {
	return {
		type: "landblock-terrain-render-artifact",
		artifactKind: "terrain",
		key: "terrain-artifact:da55ffff:build:v1:texture-pages:v1",
		requestId: "request:test",
		landblockId,
		regionNumber: 1,
		assetId: "landblock/da55ffff/outdoor",
		artifactRevision: "terrain:v1",
		buildPolicyRevision: "build:v1",
		cpuTexturePagePolicyRevision: "texture-pages:v1",
		diagnosticRootAssetIds: [],
		diagnosticPreparedAssetIds: [],
		mesh: createTerrainMesh(landblockId),
		materialResources: createTerrainMaterialResources(),
		blendPlanSignature: null,
		texturePageRefs: [],
		layerPlan: null,
		drawSlices: [],
		debugFallbackGeometry: {
			signature: "terrain:fallback",
			positions: new Float32Array(),
			uvs: null,
			indices: new Uint16Array(),
			vertexCount: 0,
			triangleCount: 0,
		},
		bvh: {
			coordinateSpace: "landblock-outdoor-terrain-local",
			nodes: [],
			items: [],
		},
		bvhItemKeys: [],
		diagnostics: {
			status: "ready",
			quadCount: 1,
			triangleCount: 2,
			texturePageRefCount: 0,
			drawSliceCount: 0,
			fallbackReasons: [],
		},
	};
}

function createTerrainMesh(landblockId: number): PreparedTerrainMesh {
	return {
		landblockId,
		gridSize: 2,
		tileSize: 16,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 16, y: 0, z: 0 },
			{ x: 0, y: 16, z: 0 },
			{ x: 16, y: 16, z: 0 },
		],
		triangles: [],
		quads: [],
		minHeight: 0,
		maxHeight: 0,
	};
}

function createTerrainMaterialResources(): TerrainMaterialResourcePlan {
	return {
		kind: "terrain-material-resource-plan",
		regionNumber: 1,
		terrainMaterialAssetId: "terrain-material/00000001",
		status: "ready",
		signature: "terrain-material:test",
		terrainTypeCount: 0,
		terrainAlphaMapCount: 0,
		roadAlphaMapCount: 0,
		uniquePcodeCount: 0,
		referencedTerrainCodes: [],
		missingTerrainTypes: [],
		missingSurfaceTextureAssetIds: [],
		missingRenderSurfaceAssetIds: [],
		unsupportedRenderSurfaceAssetIds: [],
		hasTerrainAlphaMaps: false,
		hasRoadAlphaMaps: false,
		diagnostics: [],
	};
}
