import { describe, expect, it } from "vitest";

import {
	AssetChannelController,
	createSceneCoverageRequests,
	createStaticRenderableAssetRequests,
	deriveTerrainFocusLandblockId,
	createTerrainCoverageRequest,
	createTerrainCoverageRequests,
	createFocusedAssetRequest,
	type AssetWorkerLike,
} from "./asset-channel";
import {
	prepareAssetPayload,
	type AssetWorkerResponseMessage,
} from "../../workers/asset-worker";
import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	RuntimeBatchDto,
} from "../host/contracts";
import {
	derivePreparedAssetDependencyStatus,
	getPreparedAssetDependencies,
	type PreparedAssetRecord,
} from "./types";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 4,
		entities: [
			{
				entityId: 0x01020304,
				label: "Browser Scout",
				position: { x: 12, y: -4.5, z: 1 },
				headingRadians: 0,
				appearanceId: "gfx/02000001",
				landblockId: 0x01020003,
				cellId: 3,
				locationLabel: "100.40S, 101.55W, 1.0Z",
				isLocalPlayer: true,
			},
		],
		residency: {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 1,
		},
	};
}

class FakeAssetWorker implements AssetWorkerLike {
	onmessage:
		| ((event: MessageEvent<AssetWorkerResponseMessage>) => void)
		| null = null;
	onerror: ((event: Event | ErrorEvent) => void) | null = null;

	postMessage(message: {
		type: "prepare-asset";
		request: AssetLookupRequestDto;
		response: AssetLookupResponseDto;
	}): void {
		try {
			const asset = prepareAssetPayload(message.request, message.response);
			this.onmessage?.({
				data: {
					type: "asset-ready",
					asset,
				},
			} as MessageEvent<AssetWorkerResponseMessage>);
		} catch (error) {
			this.onmessage?.({
				data: {
					type: "asset-error",
					requestId: message.request.requestId,
					assetId: message.request.assetId,
					message: error instanceof Error ? error.message : String(error),
				},
			} as MessageEvent<AssetWorkerResponseMessage>);
		}
	}

	terminate(): void {}
}

describe("asset channel controller", () => {
	it("creates a demand-driven asset request from the focused runtime entity", () => {
		const request = createFocusedAssetRequest(
			createRuntimeBatch(),
			null,
			"bootstrap",
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).toBe("terrain/0102ffff");
		expect(request?.priority).toBe("bootstrap");
	});

	it("anchors streaming terrain refreshes to the normalized focus landblock", () => {
		const request = createFocusedAssetRequest(
			{
				...createRuntimeBatch(),
				entities: [
					createRuntimeBatch().entities[0],
					{
						entityId: 0x01020305,
						label: "Dungeon Sentinel",
						position: { x: 16, y: 8, z: -3 },
						headingRadians: 0,
						appearanceId: "gfx/02000003",
						landblockId: 0x016c0155,
						cellId: 0x155,
						locationLabel: "Dungeon depth",
						isLocalPlayer: false,
					},
				],
			},
			{
				kind: "outdoor-location",
				label: "29.90S, 65.90W, 0.0Z",
				northSouth: 29.9,
				northSouthHemisphere: "S",
				eastWest: 65.9,
				eastWestHemisphere: "W",
				elevation: 0,
				source: "manual",
				landblockId: null,
			},
			"streaming",
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).toBe("terrain/2d5affff");
		expect(request?.priority).toBe("streaming");
	});

	it("derives destination terrain focus from browser coordinates when present", () => {
		const landblockId = deriveTerrainFocusLandblockId(createRuntimeBatch(), {
			kind: "outdoor-location",
			label: "29.90S, 65.90W, 0.0Z",
			northSouth: 29.9,
			northSouthHemisphere: "S",
			eastWest: 65.9,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
			landblockId: null,
		});

		expect(landblockId).toBe(0x2d5affff);
	});

	it("requests a neighboring landblock once the focus terrain is already cached", () => {
		const request = createTerrainCoverageRequest(
			createRuntimeBatch(),
			null,
			"streaming",
			{
				"terrain/0102ffff": {
					request: {
						requestId: "bootstrap-1",
						assetId: "terrain/0102ffff",
						priority: "bootstrap",
					},
					response: {
						requestId: "bootstrap-1",
						assetId: "terrain/0102ffff",
						payloadKind: "json",
						payload: {},
					},
					payload: {
						kind: "terrain-landblock",
						sourceAssetKind: "cell-landblock",
						residencyKind: "outdoor-landblock",
						provenance: {
							source: "unknown",
							sourceAssetKind: "cell-landblock",
							errorCode: null,
							detail: null,
						},
						debugPresentation: {
							primitive: "terrain-landblock-mesh",
							paletteKey: "terrain-0102ffff",
						},
						terrainMesh: {
							landblockId: 0x0102ffff,
							gridSize: 9,
							tileSize: 24,
							vertices: [],
							triangles: [],
							minHeight: 0,
							maxHeight: 12,
						},
					},
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
			},
			null,
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).not.toBe("terrain/0102ffff");
		expect(request?.assetId).toMatch(/^terrain\//);
	});

	it("returns every missing landblock in the coverage ring immediately when nothing is in flight", () => {
		const requests = createTerrainCoverageRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{
				"terrain/0102ffff": {
					request: {
						requestId: "bootstrap-1",
						assetId: "terrain/0102ffff",
						priority: "bootstrap",
					},
					response: {
						requestId: "bootstrap-1",
						assetId: "terrain/0102ffff",
						payloadKind: "json",
						payload: {},
					},
					payload: {
						kind: "terrain-landblock",
						sourceAssetKind: "cell-landblock",
						residencyKind: "outdoor-landblock",
						provenance: {
							source: "unknown",
							sourceAssetKind: "cell-landblock",
							errorCode: null,
							detail: null,
						},
						debugPresentation: {
							primitive: "terrain-landblock-mesh",
							paletteKey: "terrain-0102ffff",
						},
						terrainMesh: {
							landblockId: 0x0102ffff,
							gridSize: 9,
							tileSize: 24,
							vertices: [],
							triangles: [],
							minHeight: 0,
							maxHeight: 12,
						},
					},
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
			},
			[],
		);

		expect(requests).toHaveLength(8);
		expect(
			requests.every((request) => request.assetId !== "terrain/0102ffff"),
		).toBe(true);
	});

	it("expands streaming coverage from the requested browser landblock radius", () => {
		const requests = createTerrainCoverageRequests(
			{
				...createRuntimeBatch(),
				residency: {
					...createRuntimeBatch().residency,
					focusLandblockId: 0x40400003,
				},
			},
			null,
			"streaming",
			{},
			[],
			{ landblockRadius: 2 },
		);

		expect(requests).toHaveLength(25);
		expect(requests[0]?.assetId).toBe("terrain/4040ffff");
		expect(requests.map((request) => request.assetId)).toContain(
			"terrain/4242ffff",
		);
	});

	it("formats high-range coverage landblocks as unsigned asset ids", () => {
		const requests = createSceneCoverageRequests(
			createRuntimeBatch(),
			{
				kind: "outdoor-location",
				label: "33.50S, 72.80E, 0.0Z",
				northSouth: 33.5,
				northSouthHemisphere: "S",
				eastWest: 72.8,
				eastWestHemisphere: "E",
				elevation: 0,
				source: "manual",
				landblockId: null,
			},
			"streaming",
			{},
			[],
		);

		expect(requests.every((request) => !request.assetId.includes("/-"))).toBe(
			true,
		);
		expect(requests.map((request) => request.assetId)).toContain(
			"terrain/da55ffff",
		);
		expect(requests.map((request) => request.assetId)).toContain(
			"outdoor-static-scene/db56ffff",
		);
	});

	it("requests outdoor static scene facts for the same destination coverage as terrain", () => {
		const runtimeBatch = createRuntimeBatch();
		const requests = createSceneCoverageRequests(
			runtimeBatch,
			{
				kind: "outdoor-location",
				label: "29.90S, 65.90W, 0.0Z",
				northSouth: 29.9,
				northSouthHemisphere: "S",
				eastWest: 65.9,
				eastWestHemisphere: "W",
				elevation: 0,
				source: "manual",
				landblockId: null,
			},
			"bootstrap",
			{},
			[],
		);

		expect(requests.map((request) => request.assetId).sort()).toEqual([
			"outdoor-static-scene/2d5affff",
			"terrain/2d5affff",
		]);
	});

	it("derives demand-driven static renderable requests from prepared outdoor static scene facts", () => {
		const runtimeBatch = createRuntimeBatch();

		const requests = createStaticRenderableAssetRequests(
			runtimeBatch,
			null,
			"streaming",
			{
				"gfx-obj/01000001": createPreparedGfxObjAsset("gfx-obj/01000001"),
				"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
					"outdoor-static-scene/0102ffff",
					0x0102ffff,
					["setup-model/02000002", "gfx-obj/01000001"],
					[],
				),
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"setup-model/02000002",
		]);
	});

	it("derives demand-driven static renderable requests from generated outdoor scenery in the aggregate scene", () => {
		const runtimeBatch = createRuntimeBatch();

		const requests = createStaticRenderableAssetRequests(
			runtimeBatch,
			null,
			"streaming",
			{
				"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
					"outdoor-static-scene/0102ffff",
					0x0102ffff,
					[],
					["setup-model/02000003"],
				),
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"setup-model/02000003",
		]);
	});

	it("requests outdoor-linked interior env cells from building portal links", () => {
		const runtimeBatch = createRuntimeBatch();
		const requests = createSceneCoverageRequests(
			runtimeBatch,
			null,
			"streaming",
			{
				"outdoor-static-scene/0102ffff":
					createPreparedOutdoorStaticSceneWithBuildingPortal(
						"outdoor-static-scene/0102ffff",
						0x0102ffff,
						[0x01020155, 0x01020156],
					),
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"indoor-env-cell/01020155",
		);
		expect(requests.map((request) => request.assetId)).toContain(
			"indoor-env-cell/01020156",
		);
	});

	it("requests outdoor-linked interior environments once env-cell metadata is prepared", () => {
		const runtimeBatch = createRuntimeBatch();
		const requests = createSceneCoverageRequests(
			runtimeBatch,
			null,
			"streaming",
			{
				"outdoor-static-scene/0102ffff":
					createPreparedOutdoorStaticSceneWithBuildingPortal(
						"outdoor-static-scene/0102ffff",
						0x0102ffff,
						[0x01020155],
					),
				"indoor-env-cell/01020155": createPreparedIndoorEnvCellAsset(
					0x01020155,
					0x0d000123,
					1,
				),
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"environment/0d000123",
		);
	});

	it("requests static assets for outdoor-linked interior static objects", () => {
		const runtimeBatch = createRuntimeBatch();
		const requests = createStaticRenderableAssetRequests(
			runtimeBatch,
			null,
			"streaming",
			{
				"outdoor-static-scene/0102ffff":
					createPreparedOutdoorStaticSceneWithBuildingPortal(
						"outdoor-static-scene/0102ffff",
						0x0102ffff,
						[0x01020155],
					),
				"indoor-env-cell/01020155": createPreparedIndoorEnvCellAsset(
					0x01020155,
					0x0d000123,
					1,
					["setup-model/0200abcd"],
				),
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"setup-model/0200abcd",
		);
	});

	it("excludes already in-flight terrain assets from the immediate coverage enqueue set", () => {
		const requests = createTerrainCoverageRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{},
			["terrain/0102ffff", "terrain/0101ffff"],
		);

		expect(
			requests.some((request) => request.assetId === "terrain/0102ffff"),
		).toBe(false);
		expect(
			requests.some((request) => request.assetId === "terrain/0101ffff"),
		).toBe(false);
		expect(requests).toHaveLength(7);
	});

	it("requests indoor env-cell metadata plus first-class indoor family assets when runtime residency is indoors", () => {
		const runtimeBatch = createRuntimeBatch();
		runtimeBatch.residency.indoors = true;
		runtimeBatch.residency.focusCellId = null;
		runtimeBatch.residency.focusEnvCellId = 0x016c0155;
		runtimeBatch.residency.visibleCellIds = [0x016c0156, 0x016c0157];
		runtimeBatch.residency.seenOutside = false;
		runtimeBatch.residency.environmentId = 0x0d000001;
		runtimeBatch.residency.cellStructureId = 1;

		const requests = createSceneCoverageRequests(
			runtimeBatch,
			null,
			"streaming",
			{},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"indoor-env-cell/016c0155",
			"indoor-env-cell/016c0156",
			"indoor-env-cell/016c0157",
			"environment/0d000001",
		]);
	});

	it("requests browser-selected indoor env-cell metadata while runtime residency remains outdoors", () => {
		const requests = createSceneCoverageRequests(
			createRuntimeBatch(),
			{
				kind: "indoor-env-cell",
				label: "Env cell 0x016c0155",
				source: "manual",
				envCellId: 0x016c0155,
				landblockId: 0x016cffff,
			},
			"bootstrap",
			{},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"indoor-env-cell/016c0155",
		]);
	});

	it("expands browser-selected indoor coverage from prepared env-cell metadata", () => {
		const preparedFocusEnvCell = prepareAssetPayload(
			{
				requestId: "indoor-1",
				assetId: "indoor-env-cell/016c0155",
				priority: "bootstrap",
			},
			{
				requestId: "indoor-1",
				assetId: "indoor-env-cell/016c0155",
				payloadKind: "json",
				payload: {
					kind: "indoor-env-cell",
					residencyKind: "indoor-env-cell",
					sourceAssetKind: "env-cell",
					envCellId: 0x016c0155,
					environmentId: 0x0d000001,
					cellStructureId: 1,
					localPlacement: {
						origin: { x: 0, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
					visibleCellIds: [0x016c0156],
					seenOutside: false,
					surfaceIds: [],
					portalCount: 0,
					staticObjectCount: 0,
					staticObjects: [],
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "env-cell",
						errorCode: null,
						detail: "dats/assets.hba",
					},
				},
			},
		);

		const requests = createSceneCoverageRequests(
			createRuntimeBatch(),
			{
				kind: "indoor-env-cell",
				label: "Env cell 0x016c0155",
				source: "manual",
				envCellId: 0x016c0155,
				landblockId: 0x016cffff,
			},
			"streaming",
			{
				"indoor-env-cell/016c0155": preparedFocusEnvCell,
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"indoor-env-cell/016c0156",
			"environment/0d000001",
		]);
	});

	it("requests indoor static visual assets from prepared env-cell metadata", () => {
		const preparedFocusEnvCell = prepareAssetPayload(
			{
				requestId: "indoor-1",
				assetId: "indoor-env-cell/016c0155",
				priority: "bootstrap",
			},
			{
				requestId: "indoor-1",
				assetId: "indoor-env-cell/016c0155",
				payloadKind: "json",
				payload: {
					kind: "indoor-env-cell",
					residencyKind: "indoor-env-cell",
					sourceAssetKind: "env-cell",
					envCellId: 0x016c0155,
					environmentId: null,
					cellStructureId: null,
					localPlacement: {
						origin: { x: 0, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
					visibleCellIds: [],
					seenOutside: false,
					surfaceIds: [],
					portalCount: 0,
					staticObjectCount: 1,
					staticObjects: [
						{
							instanceId: "env-cell-016c0155-static-0-02000001",
							owningEnvCellId: 0x016c0155,
							sourceDid: 0x02000001,
							sourceAssetId: "setup-model/02000001",
							sourceIndex: 0,
							localPlacement: {
								origin: { x: 0, y: 0, z: 0 },
								orientation: { w: 1, x: 0, y: 0, z: 0 },
							},
						},
					],
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "env-cell",
						errorCode: null,
						detail: "dats/assets.hba",
					},
				},
			},
		);

		const requests = createSceneCoverageRequests(
			createRuntimeBatch(),
			{
				kind: "indoor-env-cell",
				label: "Env cell 0x016c0155",
				source: "manual",
				envCellId: 0x016c0155,
				landblockId: 0x016cffff,
			},
			"streaming",
			{
				"indoor-env-cell/016c0155": preparedFocusEnvCell,
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"setup-model/02000001",
		]);
	});

	it("prepares a looked-up asset through the worker before returning it to the frontend", async () => {
		const controller = new AssetChannelController(
			async (request) => ({
				requestId: request.requestId,
				assetId: request.assetId,
				payloadKind: "json",
				payload: {
					kind: "terrain-landblock",
					residencyKind: "outdoor-landblock",
					sourceAssetKind: "cell-landblock",
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					heights: Array.from({ length: 81 }, (_, index) => index % 9),
					terrainTypes: Array.from({ length: 81 }, (_, index) => index % 6),
					provenance: {
						source: "unknown",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: null,
					},
				},
			}),
			() => new FakeAssetWorker(),
		);

		const preparedAsset = await controller.prepareAsset({
			requestId: "bootstrap-4-runtime-terrain/0102ffff",
			assetId: "terrain/0102ffff",
			priority: "bootstrap",
		});

		expect(preparedAsset.request.assetId).toBe("terrain/0102ffff");
		expect(preparedAsset.payload.kind).toBe("terrain-landblock");
		if (preparedAsset.payload.kind !== "terrain-landblock") {
			throw new Error("expected terrain-landblock payload");
		}
		expect(preparedAsset.payload.residencyKind).toBe("outdoor-landblock");
		expect(preparedAsset.payload.debugPresentation.primitive).toBe(
			"terrain-landblock-mesh",
		);
		expect(
			preparedAsset.payload.kind === "terrain-landblock"
				? preparedAsset.payload.terrainMesh.triangles
				: [],
		).toHaveLength(128);
		expect(preparedAsset.response.payloadKind).toBe("json");

		controller.dispose();
	});

	it("coalesces concurrent direct preparation requests by asset id", async () => {
		let lookupCount = 0;
		let releaseLookup = () => {};
		const lookupGate = new Promise<void>((resolve) => {
			releaseLookup = resolve;
		});
		const controller = new AssetChannelController(
			async (request) => {
				lookupCount += 1;
				await lookupGate;
				return {
					requestId: request.requestId,
					assetId: request.assetId,
					payloadKind: "json",
					payload: {
						kind: "synthetic-leaf",
						residencyKind: "unknown",
						provenance: {
							source: "unknown",
							sourceAssetKind: "synthetic-leaf",
							errorCode: null,
							detail: "synthetic dependency leaf",
						},
					},
				};
			},
			() => new FakeAssetWorker(),
		);

		const first = controller.prepareAsset({
			requestId: "first-request",
			assetId: "synthetic/shared",
			priority: "streaming",
		});
		const second = controller.prepareAsset({
			requestId: "second-request",
			assetId: "synthetic/shared",
			priority: "bootstrap",
		});
		releaseLookup();
		const [firstAsset, secondAsset] = await Promise.all([first, second]);

		expect(lookupCount).toBe(1);
		expect(firstAsset.request.requestId).toBe("first-request");
		expect(secondAsset.request.requestId).toBe("second-request");
		expect(secondAsset.request.priority).toBe("bootstrap");
		expect(secondAsset.response.requestId).toBe("second-request");
		expect(secondAsset.response.assetId).toBe("synthetic/shared");
		controller.dispose();
	});

	it("orchestrates a synthetic dependency walk on the main thread without worker request-back", async () => {
		const responsesByAssetId: Record<
			string,
			AssetLookupResponseDto["payload"]
		> = {
			"synthetic/root": {
				kind: "dependency-manifest",
				residencyKind: "unknown",
				dependencyAssetIds: ["synthetic/leaf-b", "synthetic/leaf-a"],
				provenance: {
					source: "unknown",
					sourceAssetKind: "dependency-manifest",
					errorCode: null,
					detail: "synthetic dependency root",
				},
			},
			"synthetic/leaf-a": {
				kind: "synthetic-leaf",
				residencyKind: "unknown",
				provenance: {
					source: "unknown",
					sourceAssetKind: "synthetic-leaf",
					errorCode: null,
					detail: "synthetic dependency leaf",
				},
			},
			"synthetic/leaf-b": {
				kind: "synthetic-leaf",
				residencyKind: "unknown",
				provenance: {
					source: "unknown",
					sourceAssetKind: "synthetic-leaf",
					errorCode: null,
					detail: "synthetic dependency leaf",
				},
			},
		};
		const lookupOrder: string[] = [];
		const controller = new AssetChannelController(
			async (request) => {
				lookupOrder.push(request.assetId);
				const payload = responsesByAssetId[request.assetId];
				if (!payload) {
					throw new Error(`missing synthetic payload for ${request.assetId}`);
				}

				return {
					requestId: request.requestId,
					assetId: request.assetId,
					payloadKind: "json",
					payload,
				};
			},
			() => new FakeAssetWorker(),
		);

		const result = await controller.prepareAssetGraph({
			requestId: "synthetic-root",
			assetId: "synthetic/root",
			priority: "streaming",
		});

		expect(lookupOrder).toEqual([
			"synthetic/root",
			"synthetic/leaf-a",
			"synthetic/leaf-b",
		]);
		expect(result.preparedAssets.map((asset) => asset.request.assetId)).toEqual(
			["synthetic/root", "synthetic/leaf-a", "synthetic/leaf-b"],
		);
		expect(
			getPreparedAssetDependencies(result.rootAsset).map(
				(dependency) => dependency.assetId,
			),
		).toEqual(["synthetic/leaf-a", "synthetic/leaf-b"]);
		expect(result.dependencyStatus).toMatchObject({
			status: "ready",
			dependencyAssetIds: ["synthetic/leaf-a", "synthetic/leaf-b"],
			readyAssetIds: ["synthetic/leaf-a", "synthetic/leaf-b"],
			missingAssetIds: [],
			pendingAssetIds: [],
		});

		controller.dispose();
	});

	it("coalesces overlapping graph dependency preparation by asset id", async () => {
		const lookupAssetIds: string[] = [];
		let releaseSharedLookup = () => {};
		const sharedLookupGate = new Promise<void>((resolve) => {
			releaseSharedLookup = resolve;
		});
		const controller = new AssetChannelController(
			async (request) => {
				lookupAssetIds.push(request.assetId);
				if (request.assetId === "synthetic/root-a") {
					return createSyntheticDependencyManifestResponse(request, [
						"synthetic/shared",
					]);
				}
				if (request.assetId === "synthetic/root-b") {
					return createSyntheticDependencyManifestResponse(request, [
						"synthetic/shared",
					]);
				}
				if (request.assetId === "synthetic/shared") {
					await sharedLookupGate;
					return createSyntheticLeafResponse(request);
				}

				throw new Error(`unexpected lookup ${request.assetId}`);
			},
			() => new FakeAssetWorker(),
		);

		const first = controller.prepareAssetGraph({
			requestId: "root-a",
			assetId: "synthetic/root-a",
			priority: "streaming",
		});
		const second = controller.prepareAssetGraph({
			requestId: "root-b",
			assetId: "synthetic/root-b",
			priority: "streaming",
		});
		await waitForMicrotasks();
		releaseSharedLookup();
		const [firstGraph, secondGraph] = await Promise.all([first, second]);

		expect(
			lookupAssetIds.filter((assetId) => assetId === "synthetic/shared"),
		).toHaveLength(1);
		expect(firstGraph.preparedByAssetId["synthetic/shared"]).toBeDefined();
		expect(secondGraph.preparedByAssetId["synthetic/shared"]).toBeDefined();
		expect(
			secondGraph.preparedAssets.find(
				(asset) => asset.request.assetId === "synthetic/shared",
			)?.request.requestId,
		).toBe("root-b-dependency-synthetic/shared");
		controller.dispose();
	});

	it("derives explicit dependency readiness for partial and awaiting states", () => {
		const rootAsset = createSyntheticPreparedAsset("synthetic/root", [
			"synthetic/leaf-a",
			"synthetic/leaf-b",
		]);
		const leafAsset = createSyntheticPreparedAsset("synthetic/leaf-a", []);

		expect(derivePreparedAssetDependencyStatus(rootAsset, {})).toMatchObject({
			status: "awaiting-dependency",
			missingAssetIds: ["synthetic/leaf-a", "synthetic/leaf-b"],
		});
		expect(
			derivePreparedAssetDependencyStatus(rootAsset, {
				"synthetic/leaf-a": leafAsset,
			}),
		).toMatchObject({
			status: "partial-ready",
			readyAssetIds: ["synthetic/leaf-a"],
			missingAssetIds: ["synthetic/leaf-b"],
		});
	});

	it("maps CellLandblock samples using ACViewer's x-by-y ordering instead of a transposed row-major assumption", () => {
		const preparedAsset = prepareAssetPayload(
			{
				requestId: "bootstrap-5-runtime-terrain/0102ffff",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			},
			{
				requestId: "bootstrap-5-runtime-terrain/0102ffff",
				assetId: "terrain/0102ffff",
				payloadKind: "json",
				payload: {
					kind: "terrain-landblock",
					residencyKind: "outdoor-landblock",
					sourceAssetKind: "cell-landblock",
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					heights: Array.from({ length: 81 }, (_, index) => index),
					terrainTypes: Array.from({ length: 81 }, (_, index) => index),
					provenance: {
						source: "unknown",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: null,
					},
				},
			},
		);

		expect(preparedAsset.payload.kind).toBe("terrain-landblock");
		if (preparedAsset.payload.kind !== "terrain-landblock") {
			throw new Error("expected terrain-landblock payload");
		}
		expect(preparedAsset.payload.terrainMesh.vertices[0]?.z).toBe(0);
		expect(preparedAsset.payload.terrainMesh.vertices[1]?.z).toBe(9);
		expect(preparedAsset.payload.terrainMesh.vertices[9]?.z).toBe(1);
		expect(preparedAsset.payload.terrainMesh.triangles[0]?.terrainType).toBe(0);
		expect(preparedAsset.payload.terrainMesh.triangles[2]?.terrainType).toBe(9);
	});

	it("splits terrain quads with the retail deterministic SW-to-NE cut formula", () => {
		const preparedAsset = prepareAssetPayload(
			{
				requestId: "bootstrap-5-runtime-terrain/0102ffff",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			},
			{
				requestId: "bootstrap-5-runtime-terrain/0102ffff",
				assetId: "terrain/0102ffff",
				payloadKind: "json",
				payload: {
					kind: "terrain-landblock",
					residencyKind: "outdoor-landblock",
					sourceAssetKind: "cell-landblock",
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					heights: Array.from({ length: 81 }, (_, index) => index),
					terrainTypes: Array.from({ length: 81 }, (_, index) => index),
					provenance: {
						source: "unknown",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: null,
					},
				},
			},
		);

		expect(preparedAsset.payload.kind).toBe("terrain-landblock");
		if (preparedAsset.payload.kind !== "terrain-landblock") {
			throw new Error("expected terrain-landblock payload");
		}

		const triangles = preparedAsset.payload.terrainMesh.triangles;
		expect(triangles[0]).toMatchObject({ a: 0, b: 1, c: 10 });
		expect(triangles[1]).toMatchObject({ a: 0, b: 10, c: 9 });
		expect(triangles[2]).toMatchObject({ a: 1, b: 2, c: 10 });
		expect(triangles[3]).toMatchObject({ a: 11, b: 10, c: 2 });
	});

	it("rejects malformed json payloads before cpu-side asset preparation continues", () => {
		expect(() =>
			prepareAssetPayload(
				{
					requestId: "bootstrap-invalid-runtime-terrain/0102ffff",
					assetId: "terrain/0102ffff",
					priority: "bootstrap",
				},
				{
					requestId: "bootstrap-invalid-runtime-terrain/0102ffff",
					assetId: "terrain/0102ffff",
					payloadKind: "json",
					payload: "not-an-object",
				},
			),
		).toThrow();
	});

	it("prepares indoor env-cell and reference-first indoor structure payloads as first-class assets", () => {
		const indoorEnvCell = prepareAssetPayload(
			{
				requestId: "indoor-1",
				assetId: "indoor-env-cell/016c0155",
				priority: "bootstrap",
			},
			{
				requestId: "indoor-1",
				assetId: "indoor-env-cell/016c0155",
				payloadKind: "json",
				payload: {
					kind: "indoor-env-cell",
					residencyKind: "indoor-env-cell",
					sourceAssetKind: "env-cell",
					envCellId: 0x016c0155,
					environmentId: 0x0d000001,
					cellStructureId: 1,
					localPlacement: {
						origin: { x: 10, y: 20, z: 30 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
					visibleCellIds: [0x016c0156],
					seenOutside: false,
					surfaceIds: [0x08000001],
					portalCount: 2,
					staticObjectCount: 1,
					staticObjects: [
						{
							instanceId: "env-cell-016c0155-static-0-02000001",
							owningEnvCellId: 0x016c0155,
							sourceDid: 0x02000001,
							sourceAssetId: "setup-model/02000001",
							sourceIndex: 0,
							localPlacement: {
								origin: { x: 1, y: 2, z: 3 },
								orientation: { w: 1, x: 0, y: 0, z: 0 },
							},
						},
					],
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "env-cell",
						errorCode: null,
						detail: "dats/assets.hba",
					},
				},
			},
		);

		const environment = prepareAssetPayload(
			{
				requestId: "environment-1",
				assetId: "environment/0d000001",
				priority: "streaming",
			},
			{
				requestId: "environment-1",
				assetId: "environment/0d000001",
				payloadKind: "json",
				payload: {
					kind: "environment",
					residencyKind: "indoor-env-cell",
					sourceAssetKind: "environment",
					environmentId: 0x0d000001,
					cellStructureIds: [1],
					cellStructures: [
						{
							id: 1,
							vertexArray: {
								vertexType: null,
								vertexCount: 4,
								vertices: [
									{
										id: 0,
										origin: { x: 0, y: 0, z: 0 },
										normal: { x: 0, y: 0, z: 1 },
										uvs: [{ u: 0, v: 0 }],
									},
									{
										id: 1,
										origin: { x: 2, y: 0, z: 0 },
										normal: { x: 0, y: 0, z: 1 },
										uvs: [{ u: 1, v: 0 }],
									},
									{
										id: 2,
										origin: { x: 2, y: 2, z: 0 },
										normal: { x: 0, y: 0, z: 1 },
										uvs: [{ u: 1, v: 1 }],
									},
									{
										id: 3,
										origin: { x: 0, y: 2, z: 0 },
										normal: { x: 0, y: 0, z: 1 },
										uvs: [{ u: 0, v: 1 }],
									},
								],
							},
							drawingPolygons: [
								{
									id: 7,
									numPts: 4,
									stippling: 0,
									sidesType: 1,
									posSurface: 0x08000002,
									negSurface: 0,
									vertexIds: [0, 1, 2, 3],
									posUvIndices: [0, 0, 0, 0],
									negUvIndices: [0, 0, 0, 0],
								},
							],
							portalPolygonIds: [],
							cellBspWitness: {
								hasBsp: true,
								rootKind: "leaf",
							},
							physicsWitness: {
								polygonCount: 1,
								hasBsp: true,
								rootKind: "leaf",
							},
							drawingBsp: null,
						},
					],
					provenance: {
						source: "app-local-stub",
						sourceAssetKind: "environment",
						errorCode: null,
						detail: "reference-first",
					},
				},
			},
		);

		expect(indoorEnvCell.payload.kind).toBe("indoor-env-cell");
		if (indoorEnvCell.payload.kind !== "indoor-env-cell") {
			throw new Error("expected indoor-env-cell payload");
		}
		expect(indoorEnvCell.payload.localPlacement.origin).toEqual({
			x: 10,
			y: 20,
			z: 30,
		});
		expect(indoorEnvCell.payload.staticObjects).toHaveLength(1);
		expect(getPreparedAssetDependencies(indoorEnvCell)).toEqual([
			{ assetId: "setup-model/02000001" },
		]);
		expect(indoorEnvCell.payload.debugPresentation.primitive).toBe(
			"indoor-env-cell-metadata",
		);
		expect(environment.payload.kind).toBe("environment");
		if (environment.payload.kind !== "environment") {
			throw new Error("expected environment payload");
		}
		expect(environment.payload.debugPresentation.primitive).toBe("environment");
		expect(environment.payload.cellStructures[0]?.renderGeometry).toMatchObject(
			{
				sourceId: 1,
				vertexCount: 6,
				triangleCount: 2,
				surfaceIds: [0x08000002],
				bounds: {
					min: { x: 0, y: 0, z: 0 },
					max: { x: 2, y: 2, z: 0 },
				},
			},
		);
		expect(
			environment.payload.cellStructures[0]?.renderGeometry.triangles,
		).toEqual([
			{ polygonId: 7, surfaceId: 0x08000002, firstVertex: 0 },
			{ polygonId: 7, surfaceId: 0x08000002, firstVertex: 3 },
		]);
	});

	it("prepares gfx-obj payloads as first-class geometry leaves", () => {
		const gfxObj = prepareAssetPayload(
			{
				requestId: "gfx-obj-1",
				assetId: "gfx-obj/01000001",
				priority: "streaming",
			},
			{
				requestId: "gfx-obj-1",
				assetId: "gfx-obj/01000001",
				payloadKind: "json",
				payload: {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x01000001,
					flags: 3,
					surfaceIds: [0x08000001],
					vertexArray: {
						vertexType: 1,
						vertexCount: 4,
						vertices: [
							{
								id: 0,
								origin: { x: 0, y: 0, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 0, v: 0 }],
							},
							{
								id: 1,
								origin: { x: 2, y: 0, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 1, v: 0 }],
							},
							{
								id: 2,
								origin: { x: 2, y: 2, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 1, v: 1 }],
							},
							{
								id: 3,
								origin: { x: 0, y: 2, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 0, v: 1 }],
							},
						],
					},
					drawingPolygons: [
						{
							id: 1,
							numPts: 4,
							stippling: 0,
							sidesType: 1,
							posSurface: 0x08000001,
							negSurface: 0,
							vertexIds: [0, 1, 2, 3],
							posUvIndices: [0, 0, 0, 0],
							negUvIndices: [0, 0, 0, 0],
						},
					],
					drawingBsp: null,
					physicsWitness: {
						polygonCount: 2,
						hasBsp: true,
					},
					sortCenter: { x: 1, y: 2, z: 3 },
					didDegrade: null,
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "gfx-obj",
						errorCode: null,
						detail: "dats/assets.hba",
					},
				},
			},
		);

		expect(gfxObj.payload.kind).toBe("gfx-obj");
		if (gfxObj.payload.kind !== "gfx-obj") {
			throw new Error("expected gfx-obj payload");
		}
		expect(gfxObj.payload.gfxObjId).toBe(0x01000001);
		expect(gfxObj.payload.vertexArray.vertexCount).toBe(4);
		expect(gfxObj.payload.drawingPolygons).toHaveLength(1);
		expect(gfxObj.payload.renderGeometry).toMatchObject({
			sourceId: 0x01000001,
			vertexCount: 6,
			triangleCount: 2,
			skippedPolygonCount: 0,
			surfaceIds: [0x08000001],
			bounds: {
				min: { x: 0, y: 0, z: 0 },
				max: { x: 2, y: 2, z: 0 },
			},
		});
		expect(gfxObj.payload.renderGeometry.positions).toEqual([
			0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0,
		]);
		expect(gfxObj.payload.renderGeometry.uvs).toEqual([
			0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
		]);
		expect(gfxObj.payload.renderGeometry.triangles).toEqual([
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 0 },
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 3 },
		]);
		expect(gfxObj.payload.physicsWitness).toEqual({
			polygonCount: 2,
			hasBsp: true,
		});
	});

	it("skips gfx-obj drawing polygons that reference invalid vertices", async () => {
		const controller = new AssetChannelController(
			async (request) => ({
				requestId: request.requestId,
				assetId: request.assetId,
				payloadKind: "json",
				payload: {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x01000001,
					flags: 3,
					surfaceIds: [0x08000001],
					vertexArray: {
						vertexType: 1,
						vertexCount: 3,
						vertices: [
							{
								id: 0,
								origin: { x: 0, y: 0, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 0, v: 0 }],
							},
							{
								id: 1,
								origin: { x: 2, y: 0, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 1, v: 0 }],
							},
							{
								id: 2,
								origin: { x: 0, y: 2, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 0, v: 1 }],
							},
						],
					},
					drawingPolygons: [
						{
							id: 1,
							numPts: 3,
							stippling: 0,
							sidesType: 1,
							posSurface: 0x08000001,
							negSurface: 0,
							vertexIds: [0, 1, 2],
							posUvIndices: [0, 0, 0],
							negUvIndices: [0, 0, 0],
						},
						{
							id: 514,
							numPts: 3,
							stippling: 0,
							sidesType: 1,
							posSurface: 0x08000001,
							negSurface: 0,
							vertexIds: [0, -1, 2],
							posUvIndices: [0, 0, 0],
							negUvIndices: [0, 0, 0],
						},
					],
					drawingBsp: null,
					physicsWitness: {
						polygonCount: 2,
						hasBsp: true,
					},
					sortCenter: null,
					didDegrade: null,
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "gfx-obj",
						errorCode: null,
						detail: "dats/assets.hba",
					},
				},
			}),
			() => new FakeAssetWorker(),
		);
		const gfxObj = await controller.prepareAsset({
			requestId: "streaming-1-gfx-obj/01000001",
			assetId: "gfx-obj/01000001",
			priority: "streaming",
		});

		expect(gfxObj.payload.kind).toBe("gfx-obj");
		if (gfxObj.payload.kind !== "gfx-obj") {
			throw new Error("expected gfx-obj payload");
		}
		expect(gfxObj.payload.drawingPolygons).toHaveLength(2);
		expect(gfxObj.payload.renderGeometry).toMatchObject({
			vertexCount: 3,
			triangleCount: 1,
			skippedPolygonCount: 1,
			invalidPolygons: [
				{
					polygonId: 514,
					vertexIds: [0, -1, 2],
					missingVertexIds: [-1],
				},
			],
		});
		expect(gfxObj.payload.renderGeometry.triangles).toEqual([
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 0 },
		]);
	});

	it("reuses cached gfx-obj preparation when a duplicate graph request arrives", async () => {
		const cachedAsset = createPreparedGfxObjAsset("gfx-obj/01000001");
		let lookupCount = 0;
		const controller = new AssetChannelController(
			async () => {
				lookupCount += 1;
				throw new Error("lookup should not run for cached assets");
			},
			() => new FakeAssetWorker(),
		);

		const result = await controller.prepareAssetGraph(
			{
				requestId: "duplicate-gfx-obj",
				assetId: "gfx-obj/01000001",
				priority: "streaming",
			},
			{
				"gfx-obj/01000001": cachedAsset,
			},
		);

		expect(lookupCount).toBe(0);
		expect(result.rootAsset).toBe(cachedAsset);
		expect(result.preparedAssets).toEqual([]);
		controller.dispose();
	});

	it("prepares setup-model payloads and derives gfx-obj leaf dependencies", () => {
		const setupModel = prepareAssetPayload(
			{
				requestId: "setup-model-1",
				assetId: "setup-model/02000001",
				priority: "streaming",
			},
			{
				requestId: "setup-model-1",
				assetId: "setup-model/02000001",
				payloadKind: "json",
				payload: createSetupModelPayload([
					{ partIndex: 0, gfxObjId: 0x01000002 },
					{ partIndex: 1, gfxObjId: 0x01000001 },
					{ partIndex: 2, gfxObjId: 0x01000001 },
				]),
			},
		);

		expect(setupModel.payload.kind).toBe("setup-model");
		if (setupModel.payload.kind !== "setup-model") {
			throw new Error("expected setup-model payload");
		}
		expect(setupModel.payload.parts.map((part) => part.gfxObjAssetId)).toEqual([
			"gfx-obj/01000002",
			"gfx-obj/01000001",
			"gfx-obj/01000001",
		]);
		expect(
			getPreparedAssetDependencies(setupModel).map(({ assetId }) => assetId),
		).toEqual(["gfx-obj/01000001", "gfx-obj/01000002"]);
	});

	it("schedules setup-model gfx-obj dependencies through graph preparation", async () => {
		const lookupAssetIds: string[] = [];
		const controller = new AssetChannelController(
			async (request) => {
				lookupAssetIds.push(request.assetId);
				if (request.assetId === "setup-model/02000001") {
					return {
						requestId: request.requestId,
						assetId: request.assetId,
						payloadKind: "json",
						payload: createSetupModelPayload([
							{ partIndex: 0, gfxObjId: 0x01000002 },
							{ partIndex: 1, gfxObjId: 0x01000001 },
						]),
					};
				}

				return {
					...createPreparedGfxObjAsset(request.assetId).response,
					requestId: request.requestId,
					assetId: request.assetId,
				};
			},
			() => new FakeAssetWorker(),
		);

		const result = await controller.prepareAssetGraph({
			requestId: "setup-graph",
			assetId: "setup-model/02000001",
			priority: "streaming",
		});

		expect(lookupAssetIds).toEqual([
			"setup-model/02000001",
			"gfx-obj/01000001",
			"gfx-obj/01000002",
		]);
		expect(result.rootAsset.payload.kind).toBe("setup-model");
		expect(result.dependencyStatus).toEqual({
			status: "ready",
			dependencyAssetIds: ["gfx-obj/01000001", "gfx-obj/01000002"],
			readyAssetIds: ["gfx-obj/01000001", "gfx-obj/01000002"],
			missingAssetIds: [],
			pendingAssetIds: [],
		});
		expect(Object.keys(result.preparedByAssetId).sort()).toEqual([
			"gfx-obj/01000001",
			"gfx-obj/01000002",
			"setup-model/02000001",
		]);
		controller.dispose();
	});
});

function createSetupModelPayload(
	parts: Array<{ partIndex: number; gfxObjId: number }>,
): unknown {
	return {
		kind: "setup-model",
		residencyKind: "unknown",
		sourceAssetKind: "setup-model",
		setupModelId: 0x02000001,
		flags: 3,
		parts: parts.map((part) => ({
			partIndex: part.partIndex,
			gfxObjId: part.gfxObjId,
			gfxObjAssetId: `gfx-obj/${part.gfxObjId.toString(16).padStart(8, "0")}`,
			parentIndex: part.partIndex === 0 ? null : 0,
			scale: { x: 1, y: 1, z: 1 },
		})),
		holdingLocations: [],
		connectionPoints: [],
		placementSets: [
			{
				key: 0,
				localPlacements: parts.map(() => ({
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				})),
				hookCount: 0,
			},
		],
		collisionWitness: {
			cylSphereCount: 1,
			sphereCount: 1,
		},
		height: 2,
		radius: 1,
		stepUp: 0.5,
		stepDown: 0.25,
		sortingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
		selectionSphere: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
		lights: [],
		defaultAnimation: null,
		defaultScript: null,
		defaultMotionTable: null,
		defaultSoundTable: null,
		defaultScriptTable: null,
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "setup-model",
			errorCode: null,
			detail: "dats/assets.hba",
		},
	};
}

function createSyntheticPreparedAsset(
	assetId: string,
	dependencyAssetIds: string[],
): PreparedAssetRecord {
	return {
		request: {
			requestId: `synthetic-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `synthetic-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload: {
			kind: "dependency-manifest",
			sourceAssetKind: "dependency-manifest",
			residencyKind: "unknown",
			dependencyAssetIds,
			provenance: {
				source: "unknown",
				sourceAssetKind: "dependency-manifest",
				errorCode: null,
				detail: null,
			},
		},
		preparedAt: "2026-05-12T00:00:00.000Z",
	};
}

function createPreparedGfxObjAsset(assetId: string): PreparedAssetRecord {
	return prepareAssetPayload(
		{
			requestId: `cached-${assetId}`,
			assetId,
			priority: "streaming",
		},
		{
			requestId: `cached-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {
				kind: "gfx-obj",
				residencyKind: "unknown",
				sourceAssetKind: "gfx-obj",
				gfxObjId: 0x01000001,
				flags: null,
				surfaceIds: [0x08000001],
				vertexArray: {
					vertexType: null,
					vertexCount: 3,
					vertices: [
						{
							id: 0,
							origin: { x: 0, y: 0, z: 0 },
							normal: { x: 0, y: 0, z: 1 },
							uvs: [{ u: 0, v: 0 }],
						},
						{
							id: 1,
							origin: { x: 1, y: 0, z: 0 },
							normal: { x: 0, y: 0, z: 1 },
							uvs: [{ u: 1, v: 0 }],
						},
						{
							id: 2,
							origin: { x: 0, y: 1, z: 0 },
							normal: { x: 0, y: 0, z: 1 },
							uvs: [{ u: 0, v: 1 }],
						},
					],
				},
				drawingPolygons: [
					{
						id: 1,
						numPts: 3,
						stippling: 0,
						sidesType: 1,
						posSurface: 0x08000001,
						negSurface: 0,
						vertexIds: [0, 1, 2],
						posUvIndices: [0, 0, 0],
						negUvIndices: [0, 0, 0],
					},
				],
				drawingBsp: null,
				physicsWitness: {
					polygonCount: 1,
					hasBsp: false,
				},
				sortCenter: null,
				didDegrade: null,
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "gfx-obj",
					errorCode: null,
					detail: "test-cache",
				},
			},
		},
	);
}

function createPreparedOutdoorStaticSceneAsset(
	assetId: string,
	landblockId: number,
	scenerySourceAssetIds: string[],
	generatedSourceAssetIds: string[],
): PreparedAssetRecord {
	return prepareAssetPayload(
		{
			requestId: `cached-${assetId}`,
			assetId,
			priority: "streaming",
		},
		{
			requestId: `cached-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {
				kind: "outdoor-static-scene",
				residencyKind: "outdoor-landblock",
				sourceAssetKind: "outdoor-static-scene",
				landblockId,
				sceneryInstances: scenerySourceAssetIds.map((sourceAssetId, index) => ({
					instanceId: `${assetId}/object/${index}`,
					owningLandblockId: landblockId,
					sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
					sourceAssetId,
					sourceIndex: index,
					localPlacement: {
						origin: { x: index, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
				})),
				buildingInstances: [],
				generatedSceneryInstances: generatedSourceAssetIds.map(
					(sourceAssetId, index) => ({
						instanceId: `${assetId}/generated/${index}`,
						owningLandblockId: landblockId,
						sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
						sourceAssetId,
						sourceIndex: index,
						terrainIndex: index,
						sceneId: 0x12000001,
						sceneTemplateIndex: index,
						localPlacement: {
							origin: { x: index, y: 0, z: 0 },
							orientation: { w: 1, x: 0, y: 0, z: 0 },
						},
						scale: 1.25,
					}),
				),
				diagnostics: createOutdoorStaticSceneDiagnostics(),
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "outdoor-static-scene",
					errorCode: null,
					detail: "test-cache",
				},
			},
		},
	);
}

function createPreparedOutdoorStaticSceneWithBuildingPortal(
	assetId: string,
	landblockId: number,
	linkedEnvCellIds: number[],
): PreparedAssetRecord {
	return prepareAssetPayload(
		{
			requestId: `cached-${assetId}`,
			assetId,
			priority: "streaming",
		},
		{
			requestId: `cached-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {
				kind: "outdoor-static-scene",
				residencyKind: "outdoor-landblock",
				sourceAssetKind: "outdoor-static-scene",
				landblockId,
				sceneryInstances: [],
				buildingInstances: [
					{
						instanceId: `${assetId}/building/0`,
						owningLandblockId: landblockId,
						sourceDid: 0x02000001,
						sourceAssetId: "setup-model/02000001",
						sourceIndex: 0,
						localPlacement: {
							origin: { x: 0, y: 0, z: 0 },
							orientation: { w: 1, x: 0, y: 0, z: 0 },
						},
						numLeaves: linkedEnvCellIds.length,
						portals: [
							{
								portalId: `${assetId}/building/0/portal/0000`,
								sourceIndex: 0,
								flags: 0,
								otherCellId: 0,
								otherPortalId: 0,
								stabList: linkedEnvCellIds.map((id) => id & 0xffff),
								linkedEnvCellIds,
							},
						],
					},
				],
				generatedSceneryInstances: [],
				diagnostics: createOutdoorStaticSceneDiagnostics(),
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "outdoor-static-scene",
					errorCode: null,
					detail: "test-cache",
				},
			},
		},
	);
}

function createPreparedIndoorEnvCellAsset(
	envCellId: number,
	environmentId: number,
	cellStructureId: number,
	staticSourceAssetIds: string[] = [],
): PreparedAssetRecord {
	const assetId = `indoor-env-cell/${envCellId.toString(16).padStart(8, "0")}`;
	return prepareAssetPayload(
		{
			requestId: `cached-${assetId}`,
			assetId,
			priority: "streaming",
		},
		{
			requestId: `cached-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {
				kind: "indoor-env-cell",
				residencyKind: "indoor-env-cell",
				sourceAssetKind: "env-cell",
				envCellId,
				environmentId,
				cellStructureId,
				localPlacement: {
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				},
				visibleCellIds: [],
				seenOutside: true,
				surfaceIds: [],
				portalCount: 0,
				staticObjectCount: staticSourceAssetIds.length,
				staticObjects: staticSourceAssetIds.map((sourceAssetId, index) => ({
					instanceId: `${assetId}/static/${index}`,
					owningEnvCellId: envCellId,
					sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
					sourceAssetId,
					sourceIndex: index,
					localPlacement: {
						origin: { x: index, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
				})),
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "env-cell",
					errorCode: null,
					detail: "test-cache",
				},
			},
		},
	);
}

function createSyntheticDependencyManifestResponse(
	request: AssetLookupRequestDto,
	dependencyAssetIds: string[],
): AssetLookupResponseDto {
	return {
		requestId: request.requestId,
		assetId: request.assetId,
		payloadKind: "json",
		payload: {
			kind: "dependency-manifest",
			residencyKind: "unknown",
			dependencyAssetIds,
			provenance: {
				source: "unknown",
				sourceAssetKind: "dependency-manifest",
				errorCode: null,
				detail: "synthetic dependency root",
			},
		},
	};
}

function createSyntheticLeafResponse(
	request: AssetLookupRequestDto,
): AssetLookupResponseDto {
	return {
		requestId: request.requestId,
		assetId: request.assetId,
		payloadKind: "json",
		payload: {
			kind: "synthetic-leaf",
			residencyKind: "unknown",
			provenance: {
				source: "unknown",
				sourceAssetKind: "synthetic-leaf",
				errorCode: null,
				detail: "synthetic dependency leaf",
			},
		},
	};
}

async function waitForMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function createOutdoorStaticSceneDiagnostics() {
	const emptyLayer = {
		attempted: 0,
		accepted: 0,
		rejectedUnsupportedSource: 0,
	};

	return {
		landblockInfoAvailable: true,
		landblockInfoError: null,
		explicit: emptyLayer,
		buildings: emptyLayer,
		generated: {
			...emptyLayer,
			skippedWeenieObj: 0,
			rejectedFrequency: 0,
			rejectedBounds: 0,
			rejectedBuildingOccupancy: 0,
			rejectedObjectBounds: 0,
			objectBoundsUnavailable: 0,
			rejectedRoad: 0,
			rejectedSlope: 0,
			rejectedOverlap: 0,
		},
	};
}
