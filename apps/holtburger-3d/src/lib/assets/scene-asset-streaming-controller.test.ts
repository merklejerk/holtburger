import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBrowserLocationInput } from "../../app/browser-mode";
import type { AssetLookupRequestDto } from "../host/contracts";
import type { PreparedAssetCacheMetadata, PreparedAssetRecord } from "./types";
import { SceneAssetStreamingController } from "./scene-asset-streaming-controller";

describe("scene asset streaming controller", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs another planning pass when direct static assets add material dependencies", async () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedByAssetId: Record<string, PreparedAssetRecord> = {};
		const cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata> =
			{};
		const requestedAssetIds: string[] = [];
		const controller = new SceneAssetStreamingController({
			assetChannel: {
				async prepareAsset(request) {
					if (request.assetId === "landblock/016cffff/topology") {
						return createPreparedTopology(request);
					}
					if (request.assetId === "env-cell/016c0155") {
						return createPreparedEnvCellWithStaticGfx(
							request,
							"gfx-obj/02000001",
						);
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
			applyAssetCachePruneBatch: () => {},
			applyAssetError: (request, message) => {
				throw new Error(`${request.assetId}: ${message}`);
			},
			debugLog: () => {},
			warmRetainMs: 120_000,
		});

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

		syncLatestInput();
		await waitFor(() => preparedByAssetId["material/0800006c"] !== undefined);
		controller.dispose();

		expect(requestedAssetIds).toContain("landblock/016cffff/topology");
		expect(requestedAssetIds).toContain("env-cell/016c0155");
		expect(requestedAssetIds).toContain("gfx-obj/02000001");
		expect(requestedAssetIds).toContain("material/0800006c");
	});

	it("runs warm cache pruning on an independent bounded timer", async () => {
		vi.useFakeTimers();
		const preparedByAssetId: Record<string, PreparedAssetRecord> = {
			"gfx-obj/expired-a": createPreparedGfxObj("gfx-obj/expired-a", []),
			"gfx-obj/expired-b": createPreparedGfxObj("gfx-obj/expired-b", []),
			"gfx-obj/expired-c": createPreparedGfxObj("gfx-obj/expired-c", []),
		};
		const cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata> = {
			"gfx-obj/expired-a": { lastPreparedAtMs: 0, lastRetainedAtMs: 0 },
			"gfx-obj/expired-b": { lastPreparedAtMs: 0, lastRetainedAtMs: 0 },
			"gfx-obj/expired-c": { lastPreparedAtMs: 0, lastRetainedAtMs: 0 },
		};
		const prunePlans: string[][] = [];
		const controller = new SceneAssetStreamingController({
			assetChannel: {
				async prepareAsset(request) {
					throw new Error(`Unexpected direct request ${request.assetId}.`);
				},
				async prepareAssetGraph(rootRequest) {
					throw new Error(`Unexpected graph request ${rootRequest.assetId}.`);
				},
			},
			getPreparedByAssetId: () => preparedByAssetId,
			getCacheMetadataByAssetId: () => cacheMetadataByAssetId,
			markAssetsPending: () => {},
			applyPreparedAssets: () => {},
			applyAssetCachePruneBatch: (prunePlan) => {
				prunePlans.push(prunePlan.evictedAssetIds);
				for (const assetId of prunePlan.evictedAssetIds) {
					delete preparedByAssetId[assetId];
					delete cacheMetadataByAssetId[assetId];
				}
				for (const [assetId, metadata] of Object.entries(
					prunePlan.retainedMetadataByAssetId,
				)) {
					cacheMetadataByAssetId[assetId] = metadata;
				}
			},
			applyAssetError: (request, message) => {
				throw new Error(`${request.assetId}: ${message}`);
			},
			debugLog: () => {},
			nowMs: () => 10_000,
			warmRetainMs: 1_000,
			pruneIntervalMs: 1_000,
			pruneEvaluationBatchSize: 3,
			pruneEvictionBatchSize: 2,
		});

		controller.syncSceneInterest({
			browserDestination: null,
			terrainLodRadius: 0,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			envCellLodRadius: 0,
			preparedByAssetId: { ...preparedByAssetId },
		});
		await Promise.resolve();

		expect(prunePlans).toEqual([]);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(prunePlans).toEqual([
			["gfx-obj/expired-a", "gfx-obj/expired-b"],
		]);
		expect(Object.keys(preparedByAssetId).sort()).toEqual([
			"gfx-obj/expired-c",
		]);

		controller.dispose();
	});

});

function createPreparedTopology(
	request: AssetLookupRequestDto,
): PreparedAssetRecord {
	return createPreparedRecord(request, {
		kind: "landblock-topology",
		sourceAssetKind: "landblock-topology",
		residencyKind: "landblock",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "landblock-topology",
			errorCode: null,
			detail: null,
		},
		landblockId: 0x016cffff,
		landblockInfoId: 0x016cfffe,
		classification: "dungeon",
		envCells: [
			{
				memberId: "env-cell-016c0155",
				envCellId: 0x016c0155,
				assetId: "env-cell/016c0155",
				localPlacement: {
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				},
				visibleEnvCellIds: [],
				restrictionObjectId: null,
				seenOutside: null,
			},
		],
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-topology-residency",
			nodes: [],
			items: [],
		},
		diagnostics: {
			sourceRecords: [],
			omissions: [],
			errors: [],
		},
	});
}

function createPreparedEnvCellWithStaticGfx(
	request: AssetLookupRequestDto,
	gfxObjAssetId: string,
): PreparedAssetRecord {
	return createPreparedRecord(request, {
		kind: "env-cell",
		sourceAssetKind: "env-cell",
		residencyKind: "interior-cell",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "env-cell",
			errorCode: null,
			detail: null,
		},
		envCellId: 0x016c0155,
		regionId: 0x13000000,
		regionNumber: 1,
		environmentId: 0x0d000001,
		cellStructureId: 0x0d000002,
		localPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		surfaces: [],
		portals: [],
		visibleEnvCellIds: [],
		portalApertures: [],
		statics: [
			{
				instanceId: "fixture-indoor-static",
				sourceDid: 0x02000001,
				sourceAssetId: gfxObjAssetId,
				sourceIndex: 0,
				localPlacement: {
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				},
				sourceScale: { x: 1, y: 1, z: 1 },
				sourceBounds: null,
				instanceBounds: null,
			},
		],
		renderGeometry: {
			sourceId: 0x0d000002,
			vertexCount: 0,
			triangleCount: 0,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			bounds: null,
		},
		cellBsp: {
			kind: "leaf",
			index: 0,
			solid: 0,
			sphere: null,
			polyIds: [],
		},
		localBvh: {
			coordinateSpace: "env-cell-local",
			nodes: [],
			items: [],
		},
	});
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
			surfaceTextureAssetIds: [],
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
