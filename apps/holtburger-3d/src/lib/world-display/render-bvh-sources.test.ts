import { describe, expect, it } from "vitest";

import { createInitialAssetChannelState } from "../assets/types";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
import {
	buildPortalCompositeRenderBvhSources,
	calculateRenderSpaceBvhSourcesBoundsFrame,
	queryRenderSpaceBvhSources,
	type RenderSpaceBvhSource,
} from "./render-bvh-sources";
import type { RenderBounds, RenderFrustum } from "./render-spatial-math";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import { createEmptyStaticRenderableSceneModel } from "./static-renderables";
import type { TerrainSceneModel } from "./terrain-scene";

describe("queryRenderSpaceBvhSources", () => {
	it("accepts a fully contained render-space BVH subtree without child bounds tests", () => {
		const result = queryRenderSpaceBvhSources(
			[
				{
					sourceId: "test",
					nodes: [
						node(bounds(0, 2, 0, 2, 0, 2), 1, 2, []),
						node(bounds(0, 1, 0, 1, 0, 1), null, null, [0]),
						node(bounds(1, 2, 1, 2, 1, 2), null, null, [1]),
					],
					itemKeys: [
						"env-render-geometry:cell:02030100",
						"env-portal:cell:02030100:portal:portal/1",
					],
				},
			],
			frustumBounds(-10, 10, -10, 10, -10, 10),
		);

		expect([...result.visibleItemKeys]).toEqual([
			"env-portal:cell:02030100:portal:portal/1",
			"env-render-geometry:cell:02030100",
		]);
		expect(result.fallbackReasons).toEqual([]);
	});
});

describe("buildPortalCompositeRenderBvhSources", () => {
	it("builds env-cell sources from resident detailed artifacts without prepared env-cell payloads", () => {
		const envCellId = 0x02030100;
		const renderChunk = deriveStructuredCellRenderChunk(envCellId);
		const sources = buildPortalCompositeRenderBvhSources({
			assetState: createInitialAssetChannelState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			staticLandblockRenderArtifacts: createStaticLandblockArtifactSnapshot([
				createDetailedLandblockProductArtifact({ envCellId }),
			]),
			renderChunkTransforms: [
				{
					chunkKey: renderChunk.chunkKey,
					chunkLandblockId: renderChunk.chunkLandblockId,
					offset: { x: 10, y: 20, z: 30 },
				},
			],
		});

		const source = sources.envCellSourcesById.get(envCellId);
		expect(source?.sourceId).toBe("artifact-env-cell:detailed:test:2030100");
		expect(source?.itemKeys).toEqual([
			"env-render-geometry:cell:02030100",
		]);
		expect(source?.nodes[0]?.bounds).toEqual({
			min: { x: 9, y: 19, z: 29 },
			max: { x: 11, y: 21, z: 31 },
		});
		expect(sources.fallbackReasons).toEqual([]);
	});
});

describe("calculateRenderSpaceBvhSourcesBoundsFrame", () => {
	it("unions root bounds from terrain, outdoor static, and env-cell BVH sources", () => {
		const frame = calculateRenderSpaceBvhSourcesBoundsFrame({
			terrainSources: [
				source("terrain", [node(bounds(-10, 0, 2, 4, -5, 5), null, null, [])]),
			],
			outdoorStaticSources: [
				source("static", [node(bounds(20, 30, -2, 1, 6, 12), null, null, [])]),
			],
			envCellSourcesById: new Map([
				[
					0x02030100,
					source("cell", [
						node(bounds(-2, 3, -8, -4, -20, -10), null, null, []),
					]),
				],
			]),
			fallbackReasons: [],
		});

		expect(frame).toEqual({
			center: { x: 10, y: -2, z: -4 },
			size: { x: 40, y: 12, z: 32 },
			minimumSpan: 180,
		});
	});

	it("returns null when no BVH root bounds are available", () => {
		const frame = calculateRenderSpaceBvhSourcesBoundsFrame({
			terrainSources: [source("empty", [])],
			outdoorStaticSources: [],
			envCellSourcesById: new Map(),
			fallbackReasons: [],
		});

		expect(frame).toBeNull();
	});
});

function source(
	sourceId: string,
	nodes: RenderSpaceBvhSource["nodes"],
): RenderSpaceBvhSource {
	return {
		sourceId,
		nodes,
		itemKeys: [],
	};
}

function createTerrainScene(): TerrainSceneModel {
	return {
		focusLandblockId: null,
		statusText: "test",
		cacheText: "test",
		dataSourceText: "test",
		tiles: [],
	};
}

function createStaticLandblockArtifactSnapshot(
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

function createDetailedLandblockProductArtifact({
	envCellId,
}: {
	envCellId: number;
}): LandblockRenderProductWorkerResult {
	const landblockId = 0x0203ffff;
	const renderChunk = deriveStructuredCellRenderChunk(envCellId);
	return {
		type: "landblock-render-product-built",
		jobId: "job:test",
		landblockId,
		product: "outdoor-env-cells",
		requestId: "request:test",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				artifactKind: "detailed-landblock",
				key: "detailed:test",
				landblockId,
				product: "outdoor-env-cells",
				requestId: "request:test",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "pages:v1",
				selectedEnvCellIds: [envCellId],
				structuredInteriorMaterialRecords: [],
				structuredInteriorTexturePageRefs: [],
				structuredInteriorTexturePages: [],
				structuredInteriorCells: [
					{
						key: "structured-interior-cell:test",
						envCellId,
						landblockId,
						regionNumber: 0,
						environmentId: 0,
						cellStructureId: 0,
						renderChunk,
						localPlacement: identityPlacement(),
						surfaceIds: [],
						materialSlices: [],
						portals: [],
						portalApertureKeys: [],
						staticObjectCount: 0,
						cellBsp: {
							kind: "leaf",
							polygonIds: [],
							bounds: null,
						},
						renderGeometry: {
							sourceId: 0,
							vertexCount: 0,
							triangleCount: 0,
							positions: [],
							normals: [],
							uvs: [],
							triangles: [],
							surfaceIds: [],
							bounds: null,
						},
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
					envCellLocalBvhs: [
						{
							key: "env-cell-local-bvh:test",
							envCellId,
							localPlacement: identityPlacement(),
							localBvh: {
								coordinateSpace: "env-cell-local",
								nodes: [
									{
										bounds: bounds(-1, 1, -1, 1, -1, 1),
										left: null,
										right: null,
										itemIndices: [0],
									},
								],
								items: [{ kind: "render-geometry" }],
							},
						},
					],
				},
			},
		],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function identityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function node(
	boundsValue: RenderBounds,
	left: number | null,
	right: number | null,
	itemIndices: number[],
): RenderSpaceBvhSource["nodes"][number] {
	return {
		bounds: boundsValue,
		left,
		right,
		itemIndices,
	};
}

function bounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): RenderBounds {
	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function frustumBounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): RenderFrustum {
	return {
		planes: [
			{ normal: { x: 1, y: 0, z: 0 }, constant: -minX },
			{ normal: { x: -1, y: 0, z: 0 }, constant: maxX },
			{ normal: { x: 0, y: 1, z: 0 }, constant: -minY },
			{ normal: { x: 0, y: -1, z: 0 }, constant: maxY },
			{ normal: { x: 0, y: 0, z: 1 }, constant: -minZ },
			{ normal: { x: 0, y: 0, z: -1 }, constant: maxZ },
		],
	};
}
