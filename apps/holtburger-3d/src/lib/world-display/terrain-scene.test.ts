import { describe, expect, it } from "vitest";

import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { PreparedTerrainMesh, PreparedTerrainQuad } from "../assets/types";
import type { LandblockRenderPresetWorkerResult } from "./landblock-render-preset";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import { deriveTerrainSceneModelFromLandblockArtifacts } from "./terrain-scene";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import type { TerrainMaterialResourcePlan } from "./terrain-materials";

describe("deriveTerrainSceneModelFromLandblockArtifacts", () => {
	it("selects resident worker terrain artifacts for active landblocks", () => {
		const focusLandblockId = 0xda55ffff;
		const neighborLandblockId = 0xda56ffff;
		const inactiveLandblockId = 0xdb55ffff;
		const scene = deriveTerrainSceneModelFromLandblockArtifacts({
			artifacts: createSnapshot([
				createResult(focusLandblockId, "outdoor"),
				createResult(neighborLandblockId, "outdoor"),
				createResult(inactiveLandblockId, "outdoor"),
			]),
			browserDestination: createOutdoorDestination(focusLandblockId),
			terrainLandblockIds: [focusLandblockId, neighborLandblockId],
		});

		expect(scene.focusLandblockId).toBe(focusLandblockId);
		expect(scene.tiles.map((tile) => tile.landblockId)).toEqual([
			focusLandblockId,
			neighborLandblockId,
		]);
		expect(scene.tiles[0]?.isFocus).toBe(true);
		expect(scene.tiles.map((tile) => tile.dataSource)).toEqual([
			"worker-landblock-render-artifact",
			"worker-landblock-render-artifact",
		]);
		expect(scene.dataSourceText).toContain("Worker-built");
	});

	it("uses the most detailed resident preset for a landblock", () => {
		const landblockId = 0xda55ffff;
		const scene = deriveTerrainSceneModelFromLandblockArtifacts({
			artifacts: createSnapshot([
				createResult(landblockId, "outdoor", "outdoor-key"),
				createResult(
					landblockId,
					"outdoor-with-env-cells",
					"outdoor-with-env-cells-key",
				),
			]),
			browserDestination: createOutdoorDestination(landblockId),
			terrainLandblockIds: [landblockId],
		});

		expect(scene.tiles).toHaveLength(1);
		expect(scene.tiles[0]?.assetId).toBe("outdoor-with-env-cells-key");
	});

	it("waits on worker artifacts instead of falling back to prepared outdoor cache", () => {
		const landblockId = 0xda55ffff;
		const scene = deriveTerrainSceneModelFromLandblockArtifacts({
			artifacts: {
				artifacts: [],
				desiredCount: 1,
				residentCount: 0,
				inFlightCount: 1,
				staleResultCount: 0,
				committedResultCount: 0,
				evictedResultCount: 0,
				errorCount: 0,
				latestDesiredIdentityKeys: ["desired"],
			},
			browserDestination: createOutdoorDestination(landblockId),
			terrainLandblockIds: [landblockId],
		});

		expect(scene.tiles).toEqual([]);
		expect(scene.statusText).toContain("waiting for worker terrain artifact");
		expect(scene.cacheText).toContain("1 in flight");
	});
});

function createSnapshot(
	results: readonly LandblockRenderPresetWorkerResult[],
): StaticLandblockRenderArtifactStoreSnapshot {
	return {
		artifacts: results,
		desiredCount: results.length,
		residentCount: results.length,
		inFlightCount: 0,
		staleResultCount: 0,
		committedResultCount: results.length,
		evictedResultCount: 0,
		errorCount: 0,
		latestDesiredIdentityKeys: [],
	};
}

function createResult(
	landblockId: number,
	preset: LandblockRenderPresetWorkerResult["preset"],
	artifactKey = `terrain-artifact:${landblockId}:${preset}`,
): LandblockRenderPresetWorkerResult {
	return {
		type: "landblock-render-preset-built",
		jobId: `job:${landblockId}:${preset}`,
		landblockId,
		preset,
		requestId: "request",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		terrainArtifact: createTerrainArtifact(landblockId, artifactKey),
		staticBundleLayers: [],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createTerrainArtifact(
	landblockId: number,
	key: string,
): LandblockTerrainRenderArtifact {
	const mesh = createMesh(landblockId);
	return {
		type: "landblock-terrain-render-artifact",
		key,
		requestId: "request",
		landblockId,
		regionNumber: 1,
		assetId: `landblock/${landblockId.toString(16)}/outdoor`,
		artifactRevision: key,
		buildPolicyRevision: "build:v1",
		cpuTexturePagePolicyRevision: "pages:v1",
		diagnosticRootAssetIds: [],
		diagnosticPreparedAssetIds: [],
		mesh,
		materialResources: createMaterialResources(),
		blendPlanSignature: null,
		texturePageRefs: [],
		layerPlan: null,
		drawSlices: [],
		debugFallbackGeometry: {
			signature: `${key}:fallback`,
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
			quadCount: mesh.quads.length,
			triangleCount: mesh.triangles.length,
			texturePageRefCount: 0,
			drawSliceCount: 0,
			materialDiagnostics: [],
			blendDiagnostics: [],
			fallbackReasons: [],
		},
	};
}

function createMesh(landblockId: number): PreparedTerrainMesh {
	const bounds = {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 1, y: 1, z: 0 },
	};
	const quad: PreparedTerrainQuad = {
		terrainQuadId: `terrain/${landblockId}/quad/0`,
		row: 0,
		col: 0,
		quadIndex: 0,
		sourceTerrainIndices: [0, 1, 2, 3],
		vertexIndices: [0, 1, 2, 3],
		triangleIndices: [0, 1],
		diagonal: "southwest-northeast",
		cornerTerrainCodes: [1, 1, 1, 1],
		pcode: 1,
		averageHeight: 0,
		bounds,
	};
	return {
		landblockId,
		gridSize: 2,
		tileSize: 1,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
			{ x: 1, y: 1, z: 0 },
		],
		triangles: [
			{
				a: 0,
				b: 1,
				c: 2,
				quadIndex: 0,
				triangleInQuad: 0,
				debugTerrainPcode: 1,
				averageHeight: 0,
			},
			{
				a: 2,
				b: 1,
				c: 3,
				quadIndex: 0,
				triangleInQuad: 1,
				debugTerrainPcode: 1,
				averageHeight: 0,
			},
		],
		quads: [quad],
		minHeight: 0,
		maxHeight: 0,
	};
}

function createMaterialResources(): TerrainMaterialResourcePlan {
	return {
		kind: "terrain-material-resource-plan",
		regionNumber: 1,
		terrainMaterialAssetId: "terrain-material/1",
		status: "ready",
		signature: "terrain-material:ready",
		terrainTypeCount: 1,
		terrainAlphaMapCount: 0,
		roadAlphaMapCount: 0,
		uniquePcodeCount: 1,
		referencedTerrainCodes: [1],
		missingTerrainTypes: [],
		missingSurfaceTextureAssetIds: [],
		missingRenderSurfaceAssetIds: [],
		unsupportedRenderSurfaceAssetIds: [],
		hasTerrainAlphaMaps: false,
		hasRoadAlphaMaps: false,
		diagnostics: [],
	};
}

function createOutdoorDestination(
	landblockId: number,
): BrowserLocationSelection {
	return {
		kind: "outdoor-location",
		label: `0x${landblockId.toString(16)}`,
		northSouth: 0,
		northSouthHemisphere: "N",
		eastWest: 0,
		eastWestHemisphere: "E",
		elevation: 0,
		source: "manual",
		landblockId,
	};
}
