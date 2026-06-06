import { describe, expect, it } from "vitest";

import { calculateStaticLandblockArtifactSceneBoundsFrame } from "./artifact-scene-bounds";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
import type { RenderBounds } from "./render-spatial-math";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";

describe("calculateStaticLandblockArtifactSceneBoundsFrame", () => {
	it("returns null when resident artifacts have no usable bounds", () => {
		expect(
			calculateStaticLandblockArtifactSceneBoundsFrame({
				artifacts: createProductSet([]),
				renderChunkTransforms: [],
			}),
		).toBeNull();
	});

	it("unions resident terrain, static bundle, and detailed env-cell artifact bounds", () => {
		const landblockId = 0x0203ffff;
		const envCellId = 0x02030100;
		const envCellChunk = deriveStructuredCellRenderChunk(envCellId);

		const frame = calculateStaticLandblockArtifactSceneBoundsFrame({
			artifacts: createProductSet([
				createOutdoorProduct({
					landblockId,
					terrainBounds: acBounds(0, 10, 0, 4, 2, 6),
					staticBounds: bounds(-20, -10, -5, 5, -2, 2),
				}),
				createDetailedProduct({
					landblockId,
					envCellId,
					envCellLocalBounds: bounds(-1, 1, -1, 1, -1, 1),
				}),
			]),
			renderChunkTransforms: [
				{
					chunkKey: envCellChunk.chunkKey,
					chunkLandblockId: envCellChunk.chunkLandblockId,
					offset: { x: 10, y: 20, z: 30 },
				},
			],
		});

		expect(frame).toEqual({
			center: { x: 5, y: 20.5, z: 29 },
			size: { x: 30, y: 11, z: 6 },
			minimumSpan: 180,
		});
	});
});

function createProductSet(
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

function createOutdoorProduct({
	landblockId,
	terrainBounds,
	staticBounds,
}: {
	landblockId: number;
	terrainBounds: RenderBounds;
	staticBounds: RenderBounds;
}): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId: "job:outdoor",
		landblockId,
		product: "outdoor",
		requestId: "request:outdoor",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				type: "landblock-terrain-render-artifact",
				artifactKind: "terrain",
				key: "terrain:test",
				requestId: "request:outdoor",
				landblockId,
				regionNumber: 0,
				assetId: "landblock/0203ffff/outdoor",
				artifactRevision: "terrain:v1",
				buildPolicyRevision: "build:v1",
				cpuTexturePagePolicyRevision: "pages:v1",
				diagnosticRootAssetIds: [],
				diagnosticPreparedAssetIds: [],
				mesh: {
					landblockId,
					gridSize: 1,
					tileSize: 24,
					vertices: [],
					triangles: [],
					quads: [],
					minHeight: 0,
					maxHeight: 0,
				},
				materialResources: {
					signature: "materials:none",
					resourcesByPcode: new Map(),
					diagnostics: [],
				},
				blendPlanSignature: null,
				texturePageRefs: [],
				layerPlan: null,
				drawSlices: [],
				debugFallbackGeometry: {
					positions: new Float32Array(),
					normals: new Float32Array(),
					uvs: new Float32Array(),
					indices: new Uint16Array(),
				},
				bvh: {
					coordinateSpace: "landblock-outdoor-terrain-local",
					nodes: [
						{
							bounds: terrainBounds,
							left: null,
							right: null,
							itemIndices: [],
						},
					],
					items: [],
				},
				bvhItemKeys: [],
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
			},
			{
				artifactKind: "static-object-bundle",
				key: "static-bundle:test",
				scope: {
					kind: "landblock",
					landblockId,
					bundleKind: "outdoor-buildings",
				},
				landblockId,
				bundleKind: "outdoor-buildings",
				sourceRevision: "static:v1",
				rootAssetIds: [],
				preparedAssetIds: [],
				renderChunks: [],
				compactedBatches: [],
				directEntries: [],
				materialRecords: [],
				texturePageRefs: [],
				texturePages: [],
				objectRecords: [],
				spatialHints: [
					{
						key: "static:test",
						visibilityKeys: [],
						bounds: staticBounds,
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
			},
		],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createDetailedProduct({
	landblockId,
	envCellId,
	envCellLocalBounds,
}: {
	landblockId: number;
	envCellId: number;
	envCellLocalBounds: RenderBounds;
}): LandblockRenderProductWorkerResult {
	const renderChunk = deriveStructuredCellRenderChunk(envCellId);
	return {
		type: "landblock-render-product-built",
		jobId: "job:detailed",
		landblockId,
		product: "outdoor-env-cells",
		requestId: "request:detailed",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				artifactKind: "detailed-landblock",
				key: "detailed:test",
				landblockId,
				product: "outdoor-env-cells",
				requestId: "request:detailed",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "pages:v1",
				selectedEnvCellIds: [envCellId],
				structuredInteriorMaterialRecords: [],
				structuredInteriorTexturePageRefs: [],
				structuredInteriorTexturePages: [],
				structuredInteriorCells: [
					{
						key: "structured-cell:test",
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
							key: "env-cell-bvh:test",
							envCellId,
							localPlacement: identityPlacement(),
							localBvh: {
								coordinateSpace: "env-cell-local",
								nodes: [
									{
										bounds: envCellLocalBounds,
										left: null,
										right: null,
										itemIndices: [],
									},
								],
								items: [],
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

function acBounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): RenderBounds {
	return bounds(minX, maxX, minY, maxY, minZ, maxZ);
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
