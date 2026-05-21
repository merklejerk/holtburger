import { describe, expect, it } from "vitest";

import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import { planPreparedAssetCachePrune } from "./asset-cache-policy";
import type {
	PreparedAssetPayload,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedSetupModelPayload,
} from "./types";

describe("asset cache policy", () => {
	it("retains outdoor active roots and recursively prepared setup/gfx dependencies", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedLandblockPackAsset("landblock-pack/0102ffff", [
				"setup-model/02000001",
			]),
			createPreparedSetupModelAsset("setup-model/02000001", [
				"gfx-obj/01000001",
			]),
			createPreparedGfxObjAsset("gfx-obj/01000001"),
			createPreparedGfxObjAsset("gfx-obj/0badcafe"),
		]);

		const plan = planPreparedAssetCachePrune({
			preparedByAssetId,
			cacheMetadataByAssetId: createMetadata(preparedByAssetId, 0),
			activeCoverageAssetIds: ["landblock-pack/0102ffff"],
			inFlightAssetIds: [],
			nowMs: 10_000,
			warmRetainMs: 1_000,
		});

		expect(plan.retainedAssetIds).toEqual([
			"gfx-obj/01000001",
			"landblock-pack/0102ffff",
			"setup-model/02000001",
		]);
		expect(plan.evictedAssetIds).toEqual(["gfx-obj/0badcafe"]);
		expect(
			plan.cacheMetadataByAssetId["setup-model/02000001"]?.lastRetainedAtMs,
		).toBe(10_000);
	});

	it("retains indoor coverage roots, static dependencies, and in-flight ids", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedLandblockPackAsset("landblock-pack/016cffff", [
				"setup-model/02000001",
			]),
			createPreparedSetupModelAsset("setup-model/02000001", [
				"gfx-obj/01000001",
			]),
			createPreparedGfxObjAsset("gfx-obj/01000001"),
			createPreparedGfxObjAsset("gfx-obj/0badcafe"),
		]);

		const plan = planPreparedAssetCachePrune({
			preparedByAssetId,
			cacheMetadataByAssetId: createMetadata(preparedByAssetId, 0),
			activeCoverageAssetIds: ["landblock-pack/016cffff"],
			inFlightAssetIds: ["landblock-pack/0102ffff"],
			nowMs: 10_000,
			warmRetainMs: 1_000,
		});

		expect(plan.retainedAssetIds).toEqual([
			"gfx-obj/01000001",
			"landblock-pack/0102ffff",
			"landblock-pack/016cffff",
			"setup-model/02000001",
		]);
		expect(plan.evictedAssetIds).toEqual(["gfx-obj/0badcafe"]);
	});

	it("keeps warm assets inside the TTL without refreshing their retain timestamp", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedGfxObjAsset("gfx-obj/recent1"),
			createPreparedGfxObjAsset("gfx-obj/expired"),
		]);

		const plan = planPreparedAssetCachePrune({
			preparedByAssetId,
			cacheMetadataByAssetId: {
				"gfx-obj/recent1": {
					lastPreparedAtMs: 500,
					lastRetainedAtMs: 9_500,
				},
				"gfx-obj/expired": {
					lastPreparedAtMs: 500,
					lastRetainedAtMs: 7_000,
				},
			},
			activeCoverageAssetIds: [],
			inFlightAssetIds: [],
			nowMs: 10_000,
			warmRetainMs: 1_000,
		});

		expect(plan.retainedAssetIds).toEqual(["gfx-obj/recent1"]);
		expect(plan.evictedAssetIds).toEqual(["gfx-obj/expired"]);
		expect(plan.cacheMetadataByAssetId["gfx-obj/recent1"]).toEqual({
			lastPreparedAtMs: 500,
			lastRetainedAtMs: 9_500,
		});
	});
});

function indexPreparedAssets(
	assets: readonly PreparedAssetRecord[],
): Record<string, PreparedAssetRecord> {
	return Object.fromEntries(
		assets.map((asset) => [asset.request.assetId, asset]),
	);
}

function createMetadata(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	retainedAtMs: number,
) {
	return Object.fromEntries(
		Object.keys(preparedByAssetId).map((assetId) => [
			assetId,
			{
				lastPreparedAtMs: retainedAtMs,
				lastRetainedAtMs: retainedAtMs,
			},
		]),
	);
}

function createPreparedLandblockPackAsset(
	assetId: string,
	renderableAssetIds: readonly string[],
): PreparedAssetRecord {
	const landblockId = Number.parseInt(assetId.slice("landblock-pack/".length), 16);
	return createPreparedAsset(assetId, {
		kind: "landblock-pack",
		sourceAssetKind: "landblock-pack",
		residencyKind: "landblock",
		provenance: createProvenance("landblock-pack"),
		landblockId,
		landblockInfoId: landblockId & 0xffff_fffe,
		classification: "outdoor",
		sourceFacts: { buildings: [] },
		prepared: {
			terrainMesh: null,
			outdoorStaticInstances: [],
			interiorCells: [],
			staticMeshes: [],
			spatialItems: [],
			staticLandblockBvh: null,
		},
		dependencies: {
			cellDatIds: [],
			portalDatIds: [],
			renderableAssetIds: [...renderableAssetIds],
		},
		diagnostics: {
			sourceRecords: [],
			errors: [],
		},
	});
}

function createPreparedSetupModelAsset(
	assetId: string,
	gfxObjAssetIds: readonly string[],
): PreparedAssetRecord {
	return createPreparedAsset(assetId, {
		kind: "setup-model",
		sourceAssetKind: "setup-model",
		residencyKind: "unknown",
		provenance: createProvenance("setup-model"),
		setupModelId: 0x02000001,
		flags: null,
		parts: gfxObjAssetIds.map((gfxObjAssetId, partIndex) => ({
			partIndex,
			gfxObjId: 0x01000001 + partIndex,
			gfxObjAssetId,
			parentIndex: null,
			scale: null,
		})),
		holdingLocations: [],
		connectionPoints: [],
		placementSets: [],
		collisionWitness: {
			cylSphereCount: 0,
			sphereCount: 0,
		},
		height: null,
		radius: null,
		stepUp: null,
		stepDown: null,
		sortingSphere: null,
		selectionSphere: null,
		lights: [],
		defaultAnimation: null,
		defaultScript: null,
		defaultMotionTable: null,
		defaultSoundTable: null,
		defaultScriptTable: null,
	} satisfies PreparedSetupModelPayload);
}

function createPreparedGfxObjAsset(assetId: string): PreparedAssetRecord {
	return createPreparedAsset(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: createProvenance("gfx-obj"),
		gfxObjId: 0x01000001,
		flags: null,
		surfaceIds: [],
		vertexArray: {
			vertexType: null,
			vertexCount: 0,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
			rootKind: null,
		},
		renderGeometry: {
			sourceId: 0x01000001,
			vertexCount: 0,
			triangleCount: 0,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			bounds: null,
		},
		sortCenter: null,
		didDegrade: null,
	} satisfies PreparedGfxObjPayload);
}

function createPreparedAsset(
	assetId: string,
	payload: PreparedAssetPayload,
): PreparedAssetRecord {
	return {
		request: {
			requestId: `request-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `request-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: { kind: payload.kind },
		},
		payload,
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		source: "unknown" as const,
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}

function createPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function createLayerDiagnostics() {
	return {
		attempted: 1,
		accepted: 1,
		rejectedUnsupportedSource: 0,
	};
}
