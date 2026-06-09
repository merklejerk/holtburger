import { describe, expect, it } from "vitest";

import {
	planPreparedAssetCachePrune,
	planPreparedAssetCachePruneBatch,
	planPreparedAssetCachePruneBatchFromResolver,
} from "./asset-cache-policy";
import { createPreparedAssetResolverFromRecordSnapshot } from "./prepared-asset-store";
import type {
	PreparedAssetPayload,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedLandblockOutdoorPayload,
	PreparedSetupModelPayload,
} from "./types";

describe("asset cache policy", () => {
	it("retains outdoor active roots and recursively prepared setup/gfx dependencies", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedLandblockOutdoorAsset("landblock/0102ffff/outdoor", [
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
			activeCoverageAssetIds: ["landblock/0102ffff/outdoor"],
			inFlightAssetIds: [],
			nowMs: 10_000,
			warmRetainMs: 1_000,
		});

		expect(plan.retainedAssetIds).toEqual([
			"gfx-obj/01000001",
			"landblock/0102ffff/outdoor",
			"region-render-profile/1",
			"setup-model/02000001",
			"terrain-material/1",
		]);
		expect(plan.evictedAssetIds).toEqual(["gfx-obj/0badcafe"]);
		expect(
			plan.cacheMetadataByAssetId["setup-model/02000001"]?.lastRetainedAtMs,
		).toBe(10_000);
	});

	it("retains indoor coverage roots, static dependencies, and in-flight ids", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedLandblockOutdoorAsset("landblock/016cffff/outdoor", [
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
			activeCoverageAssetIds: ["landblock/016cffff/outdoor"],
			inFlightAssetIds: ["landblock/0102ffff/outdoor"],
			nowMs: 10_000,
			warmRetainMs: 1_000,
		});

		expect(plan.retainedAssetIds).toEqual([
			"gfx-obj/01000001",
			"landblock/0102ffff/outdoor",
			"landblock/016cffff/outdoor",
			"region-render-profile/1",
			"setup-model/02000001",
			"terrain-material/1",
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

	it("plans bounded prune batches without evicting hard-retained assets", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedLandblockOutdoorAsset("landblock/0102ffff/outdoor", [
				"setup-model/02000001",
			]),
			createPreparedSetupModelAsset("setup-model/02000001", [
				"gfx-obj/01000001",
			]),
			createPreparedGfxObjAsset("gfx-obj/01000001"),
			createPreparedGfxObjAsset("gfx-obj/expired-a"),
			createPreparedGfxObjAsset("gfx-obj/expired-b"),
			createPreparedGfxObjAsset("gfx-obj/expired-c"),
		]);

		const plan = planPreparedAssetCachePruneBatch({
			preparedByAssetId,
			cacheMetadataByAssetId: createMetadata(preparedByAssetId, 0),
			activeCoverageAssetIds: ["landblock/0102ffff/outdoor"],
			inFlightAssetIds: [],
			nowMs: 10_000,
			warmRetainMs: 1_000,
			cursorAssetId: null,
			maxEvaluatedAssetCount: 5,
			maxEvictedAssetCount: 2,
		});

		expect(plan.evaluatedAssetCount).toBe(5);
		expect(plan.evictedAssetIds).toEqual([
			"gfx-obj/expired-a",
			"gfx-obj/expired-b",
		]);
		expect(plan.retainedAssetIds).toEqual([
			"landblock/0102ffff/outdoor",
			"setup-model/02000001",
			"gfx-obj/01000001",
		]);
		expect(plan.nextCursorAssetId).toBe("gfx-obj/expired-b");
		expect(
			plan.retainedMetadataByAssetId["landblock/0102ffff/outdoor"]
				?.lastRetainedAtMs,
		).toBe(10_000);
	});

	it("plans bounded prune batches from resolver scan entries", () => {
		const preparedByAssetId = indexPreparedAssets([
			createPreparedLandblockOutdoorAsset("landblock/0102ffff/outdoor", [
				"setup-model/02000001",
			]),
			createPreparedSetupModelAsset("setup-model/02000001", [
				"gfx-obj/01000001",
			]),
			createPreparedGfxObjAsset("gfx-obj/01000001"),
			createPreparedGfxObjAsset("gfx-obj/expired-a"),
			createPreparedGfxObjAsset("gfx-obj/expired-b"),
			createPreparedGfxObjAsset("gfx-obj/expired-c"),
		]);
		const resolver = createPreparedAssetResolverFromRecordSnapshot({
			preparedByAssetId,
			cacheMetadataByAssetId: createMetadata(preparedByAssetId, 0),
		});
		const scanPage = resolver.scanPreparedAssets({
			cursorAssetId: null,
			limit: 5,
		});

		const plan = planPreparedAssetCachePruneBatchFromResolver({
			preparedAssets: resolver,
			candidateEntries: scanPage.entries,
			nextCandidateCursorAssetId: scanPage.nextCursorAssetId,
			activeCoverageAssetIds: ["landblock/0102ffff/outdoor"],
			inFlightAssetIds: [],
			nowMs: 10_000,
			warmRetainMs: 1_000,
			maxEvaluatedAssetCount: 5,
			maxEvictedAssetCount: 2,
		});

		expect(plan.evaluatedAssetCount).toBe(5);
		expect(plan.evictedAssetIds).toEqual([
			"gfx-obj/expired-a",
			"gfx-obj/expired-b",
		]);
		expect(plan.retainedAssetIds).toEqual([
			"landblock/0102ffff/outdoor",
			"setup-model/02000001",
			"gfx-obj/01000001",
		]);
		expect(plan.nextCursorAssetId).toBe("gfx-obj/expired-c");
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

function createPreparedLandblockOutdoorAsset(
	assetId: string,
	sourceAssetIds: readonly string[],
): PreparedAssetRecord {
	const landblockId = Number.parseInt(
		assetId.slice("landblock/".length, "landblock/".length + 8),
		16,
	);
	return createPreparedAsset(assetId, {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: createProvenance("landblock-outdoor"),
		landblockId,
		regionId: 0x13000000,
		regionNumber: 1,
		classification: "outdoor",
		terrain: {
			gridSize: 9,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [],
				items: [],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		statics: sourceAssetIds.map((sourceAssetId, sourceIndex) => ({
			kind: "explicit-object",
			instanceId: `static-${sourceIndex}`,
			sourceDid: 0x02000001 + sourceIndex,
			sourceAssetId,
			sourceIndex,
			localPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
			sourceBounds: null,
			instanceBounds: null,
			building: null,
			generated: null,
		})),
		outdoorBvh: null,
		diagnostics: {
			sourceRecords: [],
			omissions: [],
			errors: [],
		},
	} satisfies PreparedLandblockOutdoorPayload);
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
		dependencies: {
			gfxObjAssetIds: [...gfxObjAssetIds],
		},
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
		dependencies: {
			materialAssetIds: [],
		},
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
