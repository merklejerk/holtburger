import { describe, expect, it } from "vitest";
import { parseBrowserLocationInput } from "../../app/browser-mode";
import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import type { AssetLookupRequestDto } from "../host/contracts";
import { formatLandblockPackAssetId } from "../landblocks";
import type {
	PreparedAssetCacheMetadata,
	PreparedAssetRecord,
} from "./types";
import {
	SceneAssetStreamingController,
	settleWithConcurrency,
} from "./scene-asset-streaming-controller";

describe("scene asset streaming controller", () => {
	it("limits concurrent request work", async () => {
		let activeCount = 0;
		let maxActiveCount = 0;
		const results = await settleWithConcurrency(
			[1, 2, 3, 4, 5],
			2,
			async () => {
				activeCount += 1;
				maxActiveCount = Math.max(maxActiveCount, activeCount);
				await Promise.resolve();
				activeCount -= 1;
			},
		);

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(maxActiveCount).toBe(2);
	});

	it("returns rejected results without stopping queued work", async () => {
		const handledItems: number[] = [];
		const results = await settleWithConcurrency([1, 2, 3], 1, async (item) => {
			handledItems.push(item);
			if (item === 2) {
				throw new Error("test failure");
			}
		});

		expect(handledItems).toEqual([1, 2, 3]);
		expect(results.map((result) => result.status)).toEqual([
			"fulfilled",
			"rejected",
			"fulfilled",
		]);
	});

	it("runs another planning pass when direct static assets add material dependencies", async () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedByAssetId: Record<string, PreparedAssetRecord> = {};
		const cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata> = {};
		const requestedAssetIds: string[] = [];
		let controller: SceneAssetStreamingController;

		const syncLatestInput = (): void => {
			controller.syncSceneInterest({
				browserDestination: destination,
				terrainLodRadius: 1,
				buildingLodRadius: 1,
				detailLodRadius: 1,
				envCellLodRadius: 1,
				preparedByAssetId: { ...preparedByAssetId },
			});
		};

		controller = new SceneAssetStreamingController({
			assetChannel: {
				async prepareAsset(request) {
					if (request.assetId === "landblock-pack/016cffff") {
						return createDungeonPackWithStaticGfx("gfx-obj/02000001");
					}
					if (request.assetId === "gfx-obj/02000001") {
						return createPreparedGfxObj("gfx-obj/02000001", [
							"material/0800006c",
						]);
					}
					throw new Error(`Unexpected direct request ${request.assetId}.`);
				},
				async prepareAssetGraph(rootRequest) {
					requestedAssetIds.push(rootRequest.assetId);
					const rootAsset = createPreparedMaterialRecipe(rootRequest);
					return {
						rootAsset,
						preparedAssets: [rootAsset],
						preparedByAssetId: {
							...preparedByAssetId,
							[rootAsset.request.assetId]: rootAsset,
						},
						dependencyStatus: {
							status: "ready",
							dependencyAssetIds: [],
							readyAssetIds: [],
							missingAssetIds: [],
							pendingAssetIds: [],
						},
					};
				},
			},
			getPreparedByAssetId: () => preparedByAssetId,
			getCacheMetadataByAssetId: () => cacheMetadataByAssetId,
			markAssetsPending: (requests) => {
				requestedAssetIds.push(...requests.map((request) => request.assetId));
			},
			applyPreparedAssets: (assets) => {
				for (const asset of assets) {
					preparedByAssetId[asset.request.assetId] = asset;
				}
				syncLatestInput();
			},
			applyAssetCachePrune: () => {},
			applyAssetError: (request, message) => {
				throw new Error(`${request.assetId}: ${message}`);
			},
			debugLog: () => {},
			requestConcurrencyLimit: 1,
			warmRetainMs: 120_000,
		});

		syncLatestInput();
		await waitFor(() => preparedByAssetId["material/0800006c"] !== undefined);
		controller.dispose();

		expect(requestedAssetIds).toContain("landblock-pack/016cffff");
		expect(requestedAssetIds).toContain("gfx-obj/02000001");
		expect(requestedAssetIds).toContain("material/0800006c");
	});
});

function createDungeonPackWithStaticGfx(gfxObjAssetId: string): PreparedAssetRecord {
	const asset = createPreparedTerrainAsset(
		"fixture-dungeon-pack",
		formatLandblockPackAssetId(0x016cffff),
	);
	if (asset.payload.kind !== "landblock-pack") {
		throw new Error("Expected test fixture to create a landblock pack.");
	}

	asset.payload.classification = "dungeon";
	asset.payload.prepared.staticMeshes = [
		{
			instanceId: "fixture-indoor-static",
			kind: "indoor-static",
			owningLandblockId: 0x016cffff,
			owningEnvCellId: 0x016c0155,
			sourceDid: 0x02000001,
			sourceAssetId: "gfx-obj/02000001",
			sourceIndex: 0,
			localPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
			partIndex: 0,
			gfxObjId: 0x02000001,
			gfxObjAssetId,
			partPlacements: [],
			partScale: { x: 1, y: 1, z: 1 },
			sourceBounds: null,
			instanceBounds: null,
		},
	];
	asset.payload.dependencies.renderableAssetIds = [gfxObjAssetId];
	return asset;
}

function createPreparedGfxObj(
	assetId: string,
	materialAssetIds: string[],
): PreparedAssetRecord {
	const request: AssetLookupRequestDto = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming",
	};
	const payload: PreparedAssetRecord["payload"] = {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "gfx-obj",
			errorCode: null,
			detail: null,
		},
		gfxObjId: 0x02000001,
		flags: null,
		surfaceIds: materialAssetIds.map((materialAssetId) =>
			Number.parseInt(materialAssetId.slice("material/".length), 16),
		),
		vertexArray: {
			vertexType: 0,
			vertexCount: 0,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		dependencies: { materialAssetIds },
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
			rootKind: null,
		},
		renderGeometry: {
			sourceId: 0x02000001,
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
	};
	return createPreparedRecord(request, payload);
}

function createPreparedMaterialRecipe(
	request: AssetLookupRequestDto,
): PreparedAssetRecord {
	const payload: PreparedAssetRecord["payload"] = {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId: Number.parseInt(request.assetId.slice("material/".length), 16),
		surfaceType: 1,
		source: {
			kind: "solid-color",
			argb: 0xff112233,
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			renderTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
	return createPreparedRecord(request, payload);
}

function createPreparedRecord(
	request: AssetLookupRequestDto,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) {
			return;
		}
		await Promise.resolve();
	}
	throw new Error("Timed out waiting for condition.");
}
