import { describe, expect, it } from "vitest";

import type { PreparedPolygonSetBspNode } from "../assets/types";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
import {
	deriveStaticRenderableSpatialItemsFromLandblockArtifacts,
	deriveStructuredInteriorSpatialItemsFromLandblockArtifacts,
	STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
	STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
} from "./render-spatial-scene";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";

const IDENTITY_PLACEMENT = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("render spatial scene", () => {
	it("derives coarse structured-cell spatial items from detailed landblock artifacts", () => {
		const envCellId = 0x016c0155;
		const items = deriveStructuredInteriorSpatialItemsFromLandblockArtifacts(
			createStaticLandblockProductSet([
				createDetailedLandblockProductArtifact({ envCellId }),
			]),
		);

		expect(items).toHaveLength(1);
		expect(items?.[0]).toMatchObject({
			id: "structured-cell:interior-cell-shell/env-cell/016c0155",
			kind: "structured-cell",
			ownerKey: STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
			chunkKey: "landblock/016cffff",
			broadphaseBounds: {
				min: { x: 0, y: 0, z: 0 },
				max: { x: 3, y: 5, z: 1 },
			},
			pickShape: {
				kind: "box",
				bounds: {
					min: { x: 0, y: 0, z: 0 },
					max: { x: 3, y: 5, z: 1 },
				},
			},
			metadata: {
				kind: "structured-cell",
				envCellId,
				renderKey: "interior-cell-shell/env-cell/016c0155",
				isFocus: true,
			},
		});
	});

	it("returns null when no resident detailed artifacts are available", () => {
		expect(
			deriveStructuredInteriorSpatialItemsFromLandblockArtifacts(
				createStaticLandblockProductSet([]),
			),
		).toBeNull();
	});

	it("derives coarse static spatial items from static bundle artifact hints", () => {
		const items = deriveStaticRenderableSpatialItemsFromLandblockArtifacts(
			createStaticLandblockProductSet([
				createStaticBundleProductArtifact(),
			]),
		);

		expect(items).toHaveLength(1);
		expect(items?.[0]).toMatchObject({
			id: "static-renderable:outdoor-static:016cffff:tree",
			kind: "outdoor-static",
			ownerKey: STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
			chunkKey: "landblock/016cffff",
			broadphaseBounds: {
				min: { x: 1, y: 2, z: 3 },
				max: { x: 4, y: 5, z: 6 },
			},
			metadata: {
				kind: "static-renderable",
				renderKey: "outdoor-static:016cffff:tree",
				instanceId: "outdoor-static:016cffff:tree",
				staticKind: "scenery",
				renderDomain: "exterior-static",
				owningLandblockId: 0x016cffff,
				owningEnvCellId: null,
				sourceAssetId: "setup-model/02000001",
				gfxObjAssetId: "setup-model/02000001",
				gfxObjId: 0,
				partIndex: 0,
				materialSlotCount: 0,
				detailRoleKind: "artifact-static",
				detailSignature: "artifact-static:outdoor-detail",
				textureVelocitySignature: "artifact-static:none",
				artifactCoverage: {
					sourcePartHintCount: 2,
					sourcePartIndices: [0, 1],
					sourceMaterialSlotCount: 5,
					renderMaterialSlotCount: 0,
					sourceRenderTriangleCount: 0,
					sourceSkippedPolygonCount: 0,
					sourceInvalidPolygonCount: 0,
					sourcePhysicsPolygonCount: 0,
					emittedDirectEntryCount: 1,
					emittedCompactedBatchCount: 1,
					emittedGeometryEntryCount: 2,
					emittedDirectTriangleCount: 2,
					emittedCompactedBatchTriangleCount: 1,
					emittedZeroTriangleEntryCount: 0,
					zeroTriangleMaterialRecordKeys: [],
					materialTriangleCounts: [
						{
							materialRecordKey: "material:compacted",
							familyKey: "static:flat-constant-color:alpha=opaque",
							triangleCount: 1,
						},
						{
							materialRecordKey: "material:direct",
							familyKey: "static:texture-page:alpha=opaque",
							triangleCount: 2,
						},
					],
					materialRecordKeys: ["material:compacted", "material:direct"],
					materialFamilyKeys: [
						"static:flat-constant-color:alpha=opaque",
						"static:texture-page:alpha=opaque",
					],
				},
			},
		});
	});

	it("returns null for static bundle artifacts without spatial hints", () => {
		const artifact = createStaticBundleProductArtifact();
		const bundle = artifact.artifacts[0];
		if (bundle?.artifactKind !== "static-object-bundle") {
			throw new Error("test fixture should produce a static object bundle");
		}

		expect(
			deriveStaticRenderableSpatialItemsFromLandblockArtifacts(
				createStaticLandblockProductSet([
					{
						...artifact,
						artifacts: [{ ...bundle, spatialHints: [] }],
					},
				]),
			),
		).toBeNull();
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
	envCellId,
}: {
	envCellId: number;
}): LandblockRenderProductWorkerResult {
	const landblockId = (envCellId & 0xffff_0000) | 0xffff;
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
						regionNumber: 1,
						environmentId: 0x0d000001,
						cellStructureId: 1,
						renderChunk: deriveStructuredCellRenderChunk(envCellId),
						localPlacement: IDENTITY_PLACEMENT,
						surfaceIds: [],
						materialSlices: [],
						portals: [],
						portalApertureKeys: [],
						staticObjectCount: 0,
						cellBsp: createLeafBspNode(),
						renderGeometry: {
							sourceId: 1,
							vertexCount: 3,
							triangleCount: 1,
							positions: [],
							normals: [],
							uvs: [],
							triangles: [],
							surfaceIds: [],
							bounds: {
								min: { x: 0, y: 0, z: 0 },
								max: { x: 3, y: 5, z: 1 },
							},
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

function createStaticBundleProductArtifact(): LandblockRenderProductWorkerResult {
	const landblockId = 0x016cffff;
	const objectKey = "outdoor-static:016cffff:tree";
	const visibilityKey =
		"outdoor-static:landblock:016cffff:instance:tree" as const;
	return {
		type: "landblock-render-product-built",
		jobId: "job:static:test",
		landblockId,
		product: "outdoor",
		requestId: "request:static:test",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				artifactKind: "static-object-bundle",
				key: "static-bundle:test",
				scope: {
					kind: "landblock",
					landblockId,
					bundleKind: "outdoor-detail",
				},
				landblockId,
				bundleKind: "outdoor-detail",
				sourceRevision: "revision:test",
				rootAssetIds: ["landblock/016cffff/outdoor"],
				preparedAssetIds: ["landblock/016cffff/outdoor"],
				renderChunks: [
					{
						key: "render-chunk:test",
						landblockId,
						bounds: {
							min: { x: 1, y: 2, z: 3 },
							max: { x: 4, y: 5, z: 6 },
						},
					},
				],
				compactedBatches: [
					{
						key: "compacted:test",
						renderChunkKey: "render-chunk:test",
						familyKey: "static:flat-constant-color:alpha=opaque",
						materialRecordKey: "material:compacted",
						objectKeys: [objectKey],
						objectTriangleCounts: { [objectKey]: 1 },
						positions: new Float32Array(),
						normals: new Float32Array(),
						uvs: new Float32Array(),
						indices: new Uint16Array([0, 1, 2]),
					},
				],
				directEntries: [
					{
						key: "direct:test",
						renderChunkKey: "render-chunk:test",
						materialRecordKey: "material:direct",
						objectKey,
						positions: new Float32Array(),
						normals: new Float32Array(),
						uvs: new Float32Array(),
						indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
						bounds: {
							min: { x: 1, y: 2, z: 3 },
							max: { x: 4, y: 5, z: 6 },
						},
					},
				],
				materialRecords: [
					{
						key: "material:direct",
						familyKey: "static:texture-page:alpha=opaque",
						color: [1, 1, 1, 1],
						texturePageRefKeys: [],
						isTransparent: false,
					},
					{
						key: "material:compacted",
						familyKey: "static:flat-constant-color:alpha=opaque",
						color: [1, 1, 1, 1],
						texturePageRefKeys: [],
						isTransparent: false,
					},
				],
				texturePageRefs: [],
				texturePages: [],
				objectRecords: [
					{
						objectKey,
						visibilityKeys: [visibilityKey],
						sourceAssetId: "setup-model/02000001",
						owningLandblockId: landblockId,
						owningEnvCellId: null,
						kind: "scenery",
						partHints: [
							{
								renderKey: `${objectKey}:part:0`,
								partIndex: 0,
								gfxObjAssetId: "gfx-obj/01000001",
								materialSlotCount: 2,
							},
							{
								renderKey: `${objectKey}:part:1`,
								partIndex: 1,
								gfxObjAssetId: "gfx-obj/01000002",
								materialSlotCount: 3,
							},
						],
					},
				],
				spatialHints: [
					{
						key: objectKey,
						visibilityKeys: [visibilityKey],
						bounds: {
							min: { x: 1, y: 2, z: 3 },
							max: { x: 4, y: 5, z: 6 },
						},
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

function createLeafBspNode(): PreparedPolygonSetBspNode {
	return {
		kind: "leaf",
		index: 0,
		solid: 0,
		sphere: null,
		polyIds: [],
	};
}
