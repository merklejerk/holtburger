import { describe, expect, it } from "vitest";

import type { PreparedPolygonSetBspNode } from "../assets/types";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
import {
	deriveStructuredInteriorSpatialItemsFromLandblockArtifacts,
	STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
} from "./render-spatial-scene";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";

const IDENTITY_PLACEMENT = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("render spatial scene", () => {
	it("derives coarse structured-cell spatial items from detailed landblock artifacts", () => {
		const envCellId = 0x016c0155;
		const items = deriveStructuredInteriorSpatialItemsFromLandblockArtifacts(
			createStaticLandblockArtifactSnapshot([
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
				createStaticLandblockArtifactSnapshot([]),
			),
		).toBeNull();
	});
});

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

function createLeafBspNode(): PreparedPolygonSetBspNode {
	return {
		kind: "leaf",
		index: 0,
		solid: 0,
		sphere: null,
		polyIds: [],
	};
}
