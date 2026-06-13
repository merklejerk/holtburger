import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseBrowserLocationInput,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import { createSceneResourceInterestFromBrowserDestination } from "../../app/browser-scene-resource-interest";
import type { AssetLookupRequestDto } from "../host/contracts";
import { PreparedAssetStore } from "./prepared-asset-store";
import { SceneAssetStreamingController } from "./scene-asset-streaming-controller";
import type { PreparedAssetRecord } from "./types";

describe("scene asset streaming controller", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs another planning pass when direct static assets add material dependencies", async () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedAssetStore = new PreparedAssetStore();
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
			preparedAssetResolver: preparedAssetStore.resolver,
			markAssetsPending: (requests) => {
				requestedAssetIds.push(...requests.map((request) => request.assetId));
			},
			applyPreparedAssets: (assets) => {
				preparedAssetStore.applyPreparedAssets(assets);
			},
			applyAssetCachePruneBatch: () => {},
			applyAssetError: (request, message) => {
				throw new Error(`${request.assetId}: ${message}`);
			},
			debugLog: () => {},
			warmRetainMs: 120_000,
		});

		const syncLatestInput = (): void => {
			controller.syncSceneInterest(
				createStreamingSceneInterest(destination, {
					terrain: 1,
					buildings: 1,
					detail: 1,
					envCells: 1,
				}),
			);
		};

		syncLatestInput();
		await waitFor(() => preparedAssetStore.resolver.has("material/0800006c"));
		controller.dispose();

		expect(requestedAssetIds).toContain("landblock/016cffff/topology");
		expect(requestedAssetIds).toContain("env-cell/016c0155");
		expect(requestedAssetIds).toContain("gfx-obj/02000001");
		expect(requestedAssetIds).toContain("material/0800006c");
	});

	it("runs warm cache pruning on an independent bounded timer", async () => {
		vi.useFakeTimers();
		const preparedAssetStore = new PreparedAssetStore();
		preparedAssetStore.applyPreparedAssets(
			[
				createPreparedGfxObj("gfx-obj/expired-a", []),
				createPreparedGfxObj("gfx-obj/expired-b", []),
				createPreparedGfxObj("gfx-obj/expired-c", []),
			],
			0,
		);
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
			preparedAssetResolver: preparedAssetStore.resolver,
			markAssetsPending: () => {},
			applyPreparedAssets: () => {},
			applyAssetCachePruneBatch: (prunePlan) => {
				prunePlans.push(prunePlan.evictedAssetIds);
				preparedAssetStore.applyPruneBatch(prunePlan);
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

		controller.syncSceneInterest(
			createStreamingSceneInterest(null, {
				terrain: 0,
				buildings: 0,
				detail: 0,
				envCells: 0,
			}),
		);
		await Promise.resolve();

		expect(prunePlans).toEqual([]);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(prunePlans).toEqual([["gfx-obj/expired-a", "gfx-obj/expired-b"]]);
		expect(preparedAssetStore.resolver.has("gfx-obj/expired-c")).toBe(true);
		expect(preparedAssetStore.resolver.getPreparedCount()).toBe(1);

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

function createStreamingSceneInterest(
	destination: BrowserLocationSelection | null,
	lod: {
		terrain: number;
		buildings: number;
		detail: number;
		envCells: number;
	},
) {
	return createSceneResourceInterestFromBrowserDestination({
		destination,
		terrainLodRadius: lod.terrain,
		buildingLodRadius: lod.buildings,
		detailLodRadius: lod.detail,
		envCellLodRadius: lod.envCells,
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
