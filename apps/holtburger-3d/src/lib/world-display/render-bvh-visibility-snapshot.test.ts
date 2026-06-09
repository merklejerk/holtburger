import { describe, expect, it } from "vitest";

import type {
	AssetChannelState,
	PreparedAssetPayload,
	PreparedAssetRecord,
	PreparedEnvCellPayload,
	PreparedLandblockOutdoorPayload,
	PreparedTerrainMesh,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import type { StaticObjectBundleArtifact } from "./static-bundle-layer";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import {
	outdoorStaticBvhItemKey,
	terrainBvhItemKey,
} from "./prepared-bvh-visibility";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import {
	createEmptyStaticRenderableSceneModel,
	type StaticRenderableSceneModel,
} from "./static-renderables";
import { createEmptyStructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import { deriveRenderBvhVisibilityMetrics } from "./render-bvh-visibility-snapshot";
import type { RenderFrustum } from "./render-spatial-math";

describe("deriveRenderBvhVisibilityMetrics", () => {
	it("reports visible render BVH item counts without changing render state", () => {
		const landblockId = 0x0203ffff;
		const envCellId = 0x02030100;
		const outdoorPayload = createOutdoorPayload(landblockId);
		const envCellPayload = createEnvCellPayload(envCellId);
		const terrainRenderChunk = deriveLandblockRenderChunkPlacement(landblockId);
		const envRenderChunk = deriveLandblockRenderChunkPlacement(envCellId);

		const metrics = deriveRenderBvhVisibilityMetrics({
			assetState: createAssetState([outdoorPayload, envCellPayload]),
			terrainScene: createTerrainScene([createTerrainTile(landblockId)]),
			staticRenderableScene: createStaticRenderableScene(landblockId),
			structuredInteriorScene: createStructuredInteriorScene(envCellId),
			staticLandblockRenderProducts: createStaticLandblockProductSet([]),
			renderChunkTransforms: [
				{
					chunkKey: terrainRenderChunk.chunkKey,
					chunkLandblockId: terrainRenderChunk.chunkLandblockId,
					offset: { x: 0, y: 0, z: 0 },
				},
				{
					chunkKey: envRenderChunk.chunkKey,
					chunkLandblockId: envRenderChunk.chunkLandblockId,
					offset: { x: 0, y: 0, z: 0 },
				},
			],
			frustum: zFrustum(0, 10),
			now: steppingClock(),
		});

		expect(metrics.terrainBvhVisibleItemCount).toBe(1);
		expect(metrics.terrainBvhTotalItemCount).toBe(2);
		expect(metrics.outdoorStaticBvhVisibleItemCount).toBe(1);
		expect(metrics.outdoorStaticBvhTotalItemCount).toBe(1);
		expect(metrics.envCellLocalBvhVisibleItemCount).toBe(3);
		expect(metrics.envCellLocalBvhTotalItemCount).toBe(3);
		expect(metrics.visibleStaticInstanceKeyCount).toBe(2);
		expect(metrics.visiblePortalKeyCount).toBe(1);
		expect(metrics.envCellBvhConsideredCount).toBe(1);
		expect(metrics.fallbackReasonCount).toBe(0);
		expect(metrics.queryTimeMs).toBe(1);
	});

	it("reports fallback reasons for missing assets and transforms", () => {
		const landblockId = 0x0203ffff;
		const outdoorPayload = createOutdoorPayload(landblockId);

		const metrics = deriveRenderBvhVisibilityMetrics({
			assetState: createAssetState([outdoorPayload]),
			terrainScene: createTerrainScene([createTerrainTile(0x0204ffff)]),
			staticRenderableScene: createStaticRenderableScene(landblockId),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			staticLandblockRenderProducts: createStaticLandblockProductSet([]),
			renderChunkTransforms: [],
			frustum: zFrustum(0, 10),
			now: steppingClock(),
		});

		expect(metrics.fallbackReasonCount).toBe(2);
		expect(metrics.fallbackReasonSamples).toEqual([
			"missing outdoor terrain payload landblock/0204ffff/outdoor",
			"missing render chunk transform landblock/0203ffff",
		]);
	});

	it("prefers resident detailed artifact env-cell BVHs over prepared env-cell payloads", () => {
		const envCellId = 0x02030100;
		const envRenderChunk = deriveLandblockRenderChunkPlacement(envCellId);

		const metrics = deriveRenderBvhVisibilityMetrics({
			assetState: createAssetState([]),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			structuredInteriorScene: createStructuredInteriorScene(envCellId),
			staticLandblockRenderProducts: createStaticLandblockProductSet([
				createDetailedLandblockProductArtifact({
					landblockId: 0x0203ffff,
					envCellId,
				}),
			]),
			renderChunkTransforms: [
				{
					chunkKey: envRenderChunk.chunkKey,
					chunkLandblockId: envRenderChunk.chunkLandblockId,
					offset: { x: 0, y: 0, z: 0 },
				},
			],
			frustum: zFrustum(0, 10),
			now: steppingClock(),
		});

		expect(metrics.envCellLocalBvhVisibleItemCount).toBe(3);
		expect(metrics.envCellLocalBvhTotalItemCount).toBe(3);
		expect(metrics.visibleStaticInstanceKeyCount).toBe(1);
		expect(metrics.visiblePortalKeyCount).toBe(1);
		expect(metrics.envCellBvhConsideredCount).toBe(1);
		expect(metrics.fallbackReasonCount).toBe(0);
	});

	it("derives env-cell BVH visibility from detailed artifacts without structured scene cells", () => {
		const envCellId = 0x02030100;
		const envRenderChunk = deriveLandblockRenderChunkPlacement(envCellId);

		const metrics = deriveRenderBvhVisibilityMetrics({
			assetState: createAssetState([]),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			staticLandblockRenderProducts: createStaticLandblockProductSet([
				createDetailedLandblockProductArtifact({
					landblockId: 0x0203ffff,
					envCellId,
				}),
			]),
			renderChunkTransforms: [
				{
					chunkKey: envRenderChunk.chunkKey,
					chunkLandblockId: envRenderChunk.chunkLandblockId,
					offset: { x: 0, y: 0, z: 0 },
				},
			],
			frustum: zFrustum(0, 10),
			now: steppingClock(),
		});

		expect(metrics.envCellLocalBvhVisibleItemCount).toBe(3);
		expect(metrics.envCellLocalBvhTotalItemCount).toBe(3);
		expect(metrics.visibleStaticInstanceKeyCount).toBe(1);
		expect(metrics.visiblePortalKeyCount).toBe(1);
		expect(metrics.envCellBvhConsideredCount).toBe(1);
		expect(metrics.fallbackReasonCount).toBe(0);
	});

	it("derives terrain BVH visibility from resident product artifacts without terrain scene tiles", () => {
		const landblockId = 0x0203ffff;
		const terrainRenderChunk = deriveLandblockRenderChunkPlacement(landblockId);

		const metrics = deriveRenderBvhVisibilityMetrics({
			assetState: createAssetState([]),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			staticLandblockRenderProducts: createStaticLandblockProductSet([
				createOutdoorTerrainProductArtifact(landblockId),
			]),
			renderChunkTransforms: [
				{
					chunkKey: terrainRenderChunk.chunkKey,
					chunkLandblockId: terrainRenderChunk.chunkLandblockId,
					offset: { x: 0, y: 0, z: 0 },
				},
			],
			frustum: zFrustum(0, 10),
			now: steppingClock(),
		});

		expect(metrics.terrainBvhVisibleItemCount).toBe(1);
		expect(metrics.terrainBvhTotalItemCount).toBe(2);
		expect(metrics.fallbackReasonCount).toBe(0);
	});

	it("derives outdoor static BVH visibility from resident static bundle artifacts", () => {
		const landblockId = 0x0203ffff;
		const renderChunk = deriveLandblockRenderChunkPlacement(landblockId);

		const metrics = deriveRenderBvhVisibilityMetrics({
			assetState: createAssetState([createOutdoorPayload(landblockId)]),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createEmptyStaticRenderableSceneModel(),
			structuredInteriorScene: createEmptyStructuredInteriorSceneModel(),
			staticLandblockRenderProducts: createStaticLandblockProductSet([
				createOutdoorStaticBundleProductArtifact(landblockId),
			]),
			renderChunkTransforms: [
				{
					chunkKey: renderChunk.chunkKey,
					chunkLandblockId: renderChunk.chunkLandblockId,
					offset: { x: 0, y: 0, z: 0 },
				},
			],
			frustum: zFrustum(0, 10),
			now: steppingClock(),
		});

		expect(metrics.outdoorStaticBvhVisibleItemCount).toBe(1);
		expect(metrics.outdoorStaticBvhTotalItemCount).toBe(1);
		expect(metrics.visibleStaticInstanceKeyCount).toBe(1);
		expect(metrics.fallbackReasonCount).toBe(0);
	});
});

function createStaticLandblockProductSet(
	artifacts: readonly LandblockRenderProductWorkerResult[],
): StaticLandblockRenderProductSet {
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
	landblockId,
	envCellId,
}: {
	landblockId: number;
	envCellId: number;
}): LandblockRenderProductWorkerResult {
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
						renderChunk: deriveLandblockRenderChunkPlacement(envCellId),
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
							localBvh: createEnvCellPayload(envCellId).localBvh,
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

function createOutdoorTerrainProductArtifact(
	landblockId: number,
): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId: "job:terrain",
		landblockId,
		product: "outdoor-terrain",
		requestId: "request:terrain",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [createTerrainArtifact(landblockId)],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createOutdoorStaticBundleProductArtifact(
	landblockId: number,
): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId: "job:static",
		landblockId,
		product: "outdoor-buildings",
		requestId: "request:static",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [createStaticBundleArtifact(landblockId)],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createStaticBundleArtifact(
	landblockId: number,
): StaticObjectBundleArtifact {
	return {
		artifactKind: "static-object-bundle",
		key: `static-bundle:${landblockId}`,
		scope: {
			kind: "landblock",
			landblockId,
			bundleKind: "outdoor-buildings",
		},
		landblockId,
		bundleKind: "outdoor-buildings",
		sourceRevision: "static:test",
		rootAssetIds: [],
		preparedAssetIds: [],
		renderChunks: [],
		compactedBatches: [],
		directEntries: [],
		materialRecords: [],
		texturePageRefs: [],
		texturePages: [],
		objectRecords: [
			{
				objectKey: "object:tree",
				visibilityKeys: [outdoorStaticBvhItemKey(landblockId, "tree")],
				sourceAssetId: "gfx-obj/01000001",
				owningLandblockId: landblockId,
				owningEnvCellId: null,
				kind: "scenery",
			},
		],
		diagnostics: {
			sourceObjectCount: 1,
			compactedSurfaceCount: 0,
			directSurfaceCount: 0,
			skippedSurfaceCount: 0,
			missingAssetIds: [],
			skippedReasons: [],
		},
	};
}

function createTerrainArtifact(
	landblockId: number,
): LandblockTerrainRenderArtifact {
	const outdoorPayload = createOutdoorPayload(landblockId);
	return {
		type: "landblock-terrain-render-artifact",
		artifactKind: "terrain",
		key: `terrain-artifact:${landblockId}`,
		requestId: "request:terrain",
		landblockId,
		regionNumber: 0,
		assetId: formatLandblockOutdoorAssetId(landblockId),
		artifactRevision: "terrain-artifact:test",
		buildPolicyRevision: "build:v1",
		cpuTexturePagePolicyRevision: "pages:v1",
		diagnosticRootAssetIds: [],
		diagnosticPreparedAssetIds: [],
		mesh: terrainMesh(landblockId),
		materialResources: createTerrainTile(landblockId).materialResources,
		blendPlanSignature: null,
		texturePageRefs: [],
		layerPlan: null,
		drawSlices: [],
		debugFallbackGeometry: {
			sourceId: 0,
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
		bvh: outdoorPayload.terrain.terrainBvh,
		bvhItemKeys: outdoorPayload.terrain.terrainBvh.items.map((item) =>
			terrainBvhItemKey(landblockId, item.quadIndex),
		),
		diagnostics: {
			status: "ready",
			quadCount: 0,
			triangleCount: 0,
			texturePageRefCount: 0,
			drawSliceCount: 0,
			materialDiagnostics: [],
			blendDiagnostics: [],
			fallbackReasons: [],
		},
	};
}

function createAssetState(payloads: PreparedAssetPayload[]): AssetChannelState {
	return {
		preparedByAssetId: Object.fromEntries(
			payloads.map((payload) => [assetIdForPayload(payload), record(payload)]),
		),
		pendingByRequestId: {},
		diagnostics: {
			prepared: { total: payloads.length, byKind: {} },
			retained: { total: payloads.length, byKind: {} },
			evicted: { total: 0, byKind: {} },
		},
	};
}

function record(payload: PreparedAssetPayload): PreparedAssetRecord {
	const assetId = assetIdForPayload(payload);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		payload,
		preparedAt: "test",
	};
}

function assetIdForPayload(payload: PreparedAssetPayload): string {
	if (payload.kind === "landblock-outdoor") {
		return formatLandblockOutdoorAssetId(payload.landblockId);
	}
	if (payload.kind === "env-cell") {
		return formatEnvCellAssetId(payload.envCellId);
	}
	throw new Error(`Unsupported test payload kind ${payload.kind}`);
}

function createTerrainScene(tiles: TerrainSceneTile[]): TerrainSceneModel {
	return {
		focusLandblockId: tiles[0]?.landblockId ?? null,
		statusText: "test terrain",
		cacheText: "test terrain cache",
		dataSourceText: "test terrain source",
		tiles,
	};
}

function createTerrainTile(landblockId: number): TerrainSceneTile {
	return {
		assetId: formatLandblockOutdoorAssetId(landblockId),
		landblockId,
		label: `0x${landblockId.toString(16)}`,
		isFocus: true,
		chunkLocalOffset: { x: 0, y: 0, z: 0 },
		mesh: terrainMesh(landblockId),
		materialResources: {
			kind: "terrain-material-resource-plan",
			regionNumber: 0,
			terrainMaterialAssetId: "terrain-material/test",
			status: "ready",
			signature: "terrain:test",
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
		},
		terrainArtifact: null,
		dataSource: "repo-local-cell-landblock",
	};
}

function createStaticRenderableScene(
	landblockId: number,
): StaticRenderableSceneModel {
	const scene = createEmptyStaticRenderableSceneModel();
	scene.sourceInstances = [
		{
			kind: "scenery",
			instanceId: "tree",
			owningLandblockId: landblockId,
			regionNumber: 0,
			owningEnvCellId: null,
			sourceDid: 0x01000001,
			sourceAssetId: "gfx-obj/01000001",
			sourceIndex: 0,
			parentPlacements: [],
			chunkLocalInstancePlacement: identityPlacement(),
			sourceScale: { x: 1, y: 1, z: 1 },
			numLeaves: null,
		},
	];
	return scene;
}

function createStructuredInteriorScene(envCellId: number) {
	const envRenderChunk = deriveLandblockRenderChunkPlacement(envCellId);
	return {
		...createEmptyStructuredInteriorSceneModel(),
		activeEnvCellIds: [envCellId],
		cells: [
			{
				renderKey: "env-cell/02030100",
				envCellId,
				regionNumber: 0,
				renderChunk: envRenderChunk,
				environmentId: 0,
				cellStructureId: 0,
				isFocus: true,
				chunkLocalPlacement: identityPlacement(),
				surfaceIds: [],
				portalCount: 0,
				portals: [],
				portalApertures: [],
				staticObjectCount: 0,
				cellStructure: null,
				cellBsp: null,
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
				debugColorKey: "env-cell/02030100",
				detailSignature: "detail:none",
			},
		],
	};
}

function createOutdoorPayload(
	landblockId: number,
): PreparedLandblockOutdoorPayload {
	return {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: provenance(),
		landblockId,
		regionId: 0,
		regionNumber: 0,
		classification: "outdoor",
		terrain: {
			gridSize: 0,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [
					node(bounds(-1, 1, -1, 1, 2, 22), 1, 2, []),
					node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0]),
					node(bounds(-1, 1, -1, 1, 20, 22), null, null, [1]),
				],
				items: [
					{ row: 0, col: 0, quadIndex: 0, triangleIndices: [0, 1] },
					{ row: 0, col: 1, quadIndex: 1, triangleIndices: [2, 3] },
				],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		statics: [],
		outdoorBvh: {
			coordinateSpace: "landblock-render-local",
			nodes: [node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0])],
			items: [{ kind: "static", instanceId: "tree" }],
		},
		diagnostics: emptyDiagnostics(),
	};
}

function createEnvCellPayload(envCellId: number): PreparedEnvCellPayload {
	return {
		kind: "env-cell",
		sourceAssetKind: "env-cell",
		residencyKind: "interior-cell",
		provenance: provenance(),
		envCellId,
		environmentId: 0,
		cellStructureId: 0,
		regionNumber: 0,
		localPlacement: identityPlacement(),
		surfaces: [],
		portals: [],
		visibleEnvCellIds: [],
		portalApertures: [],
		statics: [],
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
		cellBsp: null,
		localBvh: {
			coordinateSpace: "env-cell-local",
			nodes: [node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0, 1, 2])],
			items: [
				{ kind: "render-geometry", polygonId: null, triangleRange: [0, 3] },
				{ kind: "static", instanceId: "chair" },
				{ kind: "portal", portalId: "portal/0" },
			],
		},
		diagnostics: emptyDiagnostics(),
	};
}

function terrainMesh(landblockId: number): PreparedTerrainMesh {
	return {
		landblockId,
		gridSize: 0,
		tileSize: 24,
		vertices: [],
		triangles: [],
		quads: [],
		minHeight: 0,
		maxHeight: 0,
	};
}

function node(
	boundsValue: ReturnType<typeof bounds>,
	left: number | null,
	right: number | null,
	itemIndices: number[],
) {
	return {
		bounds: boundsValue,
		left,
		right,
		itemIndices,
		kindMask: 0,
	};
}

function bounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
) {
	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function zFrustum(minZ: number, maxZ: number): RenderFrustum {
	return {
		planes: [
			{ normal: { x: 1, y: 0, z: 0 }, constant: 10 },
			{ normal: { x: -1, y: 0, z: 0 }, constant: 10 },
			{ normal: { x: 0, y: 1, z: 0 }, constant: 10 },
			{ normal: { x: 0, y: -1, z: 0 }, constant: 10 },
			{ normal: { x: 0, y: 0, z: 1 }, constant: -minZ },
			{ normal: { x: 0, y: 0, z: -1 }, constant: maxZ },
		],
	};
}

function identityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function provenance() {
	return {
		source: "repo-local-hba" as const,
		sourceAssetKind: null,
		errorCode: null,
		detail: null,
	};
}

function emptyDiagnostics() {
	return {
		sourceRecords: [],
		omissions: [],
		errors: [],
	};
}

function steppingClock(): () => number {
	let time = 0;
	return () => time++;
}
