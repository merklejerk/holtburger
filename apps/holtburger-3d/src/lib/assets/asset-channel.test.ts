import { describe, expect, it } from "vitest";

import { AssetChannelController, type AssetWorkerLike } from "./asset-channel";
import {
	createSceneCoverageRequests,
	createStaticRenderableAssetRequests,
	deriveTerrainFocusLandblockId,
	createOutdoorLandblockPackCoverageRequest,
	createOutdoorLandblockPackCoverageRequests,
	createFocusedAssetRequest,
} from "./scene-asset-request-planner";
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
	type PreparedLandblockStaticMesh,
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
		expect(request?.assetId).toBe("landblock-pack/0102ffff");
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
		expect(request?.assetId).toBe("landblock-pack/2d5affff");
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
		const request = createOutdoorLandblockPackCoverageRequest(
			createRuntimeBatch(),
			null,
			"streaming",
			{
				"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff),
			},
			null,
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).not.toBe("landblock-pack/0102ffff");
		expect(request?.assetId).toMatch(/^landblock-pack\//);
	});

	it("returns every missing landblock coverage asset immediately when nothing is in flight", () => {
		const requests = createOutdoorLandblockPackCoverageRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{
				"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff),
			},
			[],
		);

		const assetIds = requests.map((request) => request.assetId);
		const packAssetIds = assetIds.filter((assetId) =>
			assetId.startsWith("landblock-pack/"),
		);
		const summaryAssetIds = assetIds.filter((assetId) =>
			assetId.startsWith("landblock-summary/"),
		);

		expect(packAssetIds).toHaveLength(8);
		expect(summaryAssetIds.length).toBeGreaterThan(0);
		expect(
			requests.every(
				(request) => request.assetId !== "landblock-pack/0102ffff",
			),
		).toBe(true);
	});

	it("expands streaming coverage from the requested browser landblock radius", () => {
		const requests = createOutdoorLandblockPackCoverageRequests(
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
			{ terrainRadius: 2, buildingRadius: 2, detailRadius: 2 },
		);

		expect(requests).toHaveLength(25);
		expect(requests.map((request) => request.assetId)).toContain(
			"landblock-pack/4040ffff",
		);
		expect(requests.map((request) => request.assetId)).toContain(
			"landblock-pack/4242ffff",
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
			"landblock-pack/da55ffff",
		);
	});

	it("requests one landblock pack for destination bootstrap coverage", () => {
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
			"landblock-pack/2d5affff",
		]);
	});

	it("requests summaries for building LoD without promoting those landblocks to full packs", () => {
		const requests = createSceneCoverageRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{},
			[],
			{ terrainRadius: 2, buildingRadius: 1, detailRadius: 0 },
		).map((request) => request.assetId);

		expect(requests).toContain("landblock-pack/0102ffff");
		expect(requests).toContain("landblock-summary/0202ffff");
		expect(requests).toContain("landblock-summary/0302ffff");
		expect(requests).not.toContain("landblock-pack/0202ffff");
	});

	it("derives demand-driven static renderable requests from prepared landblock pack facts", () => {
		const runtimeBatch = createRuntimeBatch();

		const requests = createStaticRenderableAssetRequests(
			runtimeBatch,
			null,
			"streaming",
			{
				"gfx-obj/01000001": createPreparedGfxObjAsset("gfx-obj/01000001"),
				"landblock-pack/0102ffff": createPreparedLandblockPackAsset(
					0x0102ffff,
					[
						createPreparedLandblockStaticMesh(
							0x0102ffff,
							"setup-model/02000002",
							"gfx-obj/01000002",
						),
						createPreparedLandblockStaticMesh(
							0x0102ffff,
							"gfx-obj/01000001",
							"gfx-obj/01000001",
						),
					],
				),
			},
			[],
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"gfx-obj/01000002",
		]);
	});

	it("hydrates pack-prepared building meshes farther out than detail scenery meshes", () => {
		const requests = createStaticRenderableAssetRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{
				"landblock-pack/0102ffff": createPreparedLandblockPackAsset(
					0x0102ffff,
					[
						createPreparedLandblockStaticMesh(
							0x0102ffff,
							"setup-model/02000002",
							"gfx-obj/01000002",
							"scenery",
						),
						createPreparedLandblockStaticMesh(
							0x0102ffff,
							"setup-model/02000003",
							"gfx-obj/01000003",
							"building",
						),
					],
				),
				"landblock-pack/0203ffff": createPreparedLandblockPackAsset(
					0x0203ffff,
					[
						createPreparedLandblockStaticMesh(
							0x0203ffff,
							"setup-model/02000004",
							"gfx-obj/01000004",
							"scenery",
						),
					],
				),
			},
			[],
			{ terrainRadius: 2, buildingRadius: 1, detailRadius: 0 },
		).map((request) => request.assetId);

		expect(requests).toContain("gfx-obj/01000002");
		expect(requests).toContain("gfx-obj/01000003");
		expect(requests).not.toContain("gfx-obj/01000004");
	});

	it("hydrates selected summary building source assets without full pack promotion", () => {
		const requests = createStaticRenderableAssetRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{
				"landblock-summary/0202ffff": createPreparedLandblockSummaryAsset(
					0x0202ffff,
					"setup-model/02000002",
				),
				"landblock-summary/0303ffff": createPreparedLandblockSummaryAsset(
					0x0303ffff,
					"setup-model/02000003",
				),
				"landblock-pack/0000ffff": createPreparedLandblockPackAsset(0x0000ffff),
			},
			[],
			{ terrainRadius: 2, buildingRadius: 1, detailRadius: 0 },
		).map((request) => request.assetId);

		expect(requests).toContain("setup-model/02000002");
		expect(requests).not.toContain("setup-model/02000003");
	});

	it("excludes already in-flight coverage assets from the immediate coverage enqueue set", () => {
		const requests = createOutdoorLandblockPackCoverageRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{},
			["landblock-pack/0102ffff", "landblock-pack/0101ffff"],
		);

		expect(
			requests.some((request) => request.assetId === "landblock-pack/0102ffff"),
		).toBe(false);
		expect(
			requests.some((request) => request.assetId === "landblock-pack/0101ffff"),
		).toBe(false);
		expect(
			requests.filter((request) =>
				request.assetId.startsWith("landblock-pack/"),
			),
		).toHaveLength(7);
	});

	it("requests the focused landblock pack when runtime residency is indoors", () => {
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
			"landblock-pack/016cffff",
		]);
	});

	it("requests browser-selected indoor landblock pack while runtime residency remains outdoors", () => {
		const requests = createSceneCoverageRequests(
			createRuntimeBatch(),
			{
				kind: "interior-cell",
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
			"landblock-pack/016cffff",
		]);
	});

	it("prepares a looked-up asset through the worker before returning it to the frontend", async () => {
		const controller = new AssetChannelController(
			async (request) => ({
				requestId: request.requestId,
				assetId: request.assetId,
				payloadKind: "json",
				payload: createSetupModelPayload([{ partIndex: 0, gfxObjId: 0x01000001 }]),
			}),
			() => new FakeAssetWorker(),
		);

		const preparedAsset = await controller.prepareAsset({
			requestId: "bootstrap-4-runtime-setup-model/02000001",
			assetId: "setup-model/02000001",
			priority: "bootstrap",
		});

		expect(preparedAsset.request.assetId).toBe("setup-model/02000001");
		expect(preparedAsset.payload.kind).toBe("setup-model");
		if (preparedAsset.payload.kind !== "setup-model") {
			throw new Error("expected setup-model payload");
		}
		expect(preparedAsset.payload.parts).toHaveLength(1);
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

	it("coalesces response lookups while preserving caller-specific metadata", async () => {
		let lookupCount = 0;
		let releaseLookup = () => {};
		const lookupGate = new Promise<void>((resolve) => {
			releaseLookup = resolve;
		});
		const controller = new AssetChannelController(
			async (request) => {
				lookupCount += 1;
				await lookupGate;
				return createSyntheticDependencyManifestResponse(request, [
					"synthetic/leaf",
				]);
			},
			() => new FakeAssetWorker(),
		);

		const first = controller.lookupAssetResponse({
			requestId: "first-response-request",
			assetId: "synthetic/root",
			priority: "streaming",
		});
		const second = controller.lookupAssetResponse({
			requestId: "second-response-request",
			assetId: "synthetic/root",
			priority: "bootstrap",
		});
		releaseLookup();
		const [firstResponse, secondResponse] = await Promise.all([first, second]);

		expect(lookupCount).toBe(1);
		expect(firstResponse.request.requestId).toBe("first-response-request");
		expect(firstResponse.response.requestId).toBe("first-response-request");
		expect(secondResponse.request.requestId).toBe("second-response-request");
		expect(secondResponse.request.priority).toBe("bootstrap");
		expect(secondResponse.response.requestId).toBe("second-response-request");
		expect(secondResponse.dependencyAssetIds).toEqual(["synthetic/leaf"]);
		controller.dispose();
	});

	it("coalesces response lookup and preparation for the same asset id", async () => {
		let lookupCount = 0;
		let releaseLookup = () => {};
		const lookupGate = new Promise<void>((resolve) => {
			releaseLookup = resolve;
		});
		const controller = new AssetChannelController(
			async (request) => {
				lookupCount += 1;
				await lookupGate;
				return createSyntheticDependencyManifestResponse(request, [
					"synthetic/leaf",
				]);
			},
			() => new FakeAssetWorker(),
		);

		const lookup = controller.lookupAssetResponse({
			requestId: "lookup-only",
			assetId: "synthetic/root",
			priority: "streaming",
		});
		const prepared = controller.prepareAsset({
			requestId: "prepare-same-root",
			assetId: "synthetic/root",
			priority: "bootstrap",
		});
		releaseLookup();
		const [lookedUp, preparedAsset] = await Promise.all([lookup, prepared]);

		expect(lookupCount).toBe(1);
		expect(lookedUp.request.requestId).toBe("lookup-only");
		expect(preparedAsset.request.requestId).toBe("prepare-same-root");
		expect(preparedAsset.response.requestId).toBe("prepare-same-root");
		controller.dispose();
	});

	it("rejects in-flight response lookup wrappers on dispose", async () => {
		const controller = new AssetChannelController(
			async () => new Promise<AssetLookupResponseDto>(() => {}),
			() => new FakeAssetWorker(),
		);

		const response = controller.lookupAssetResponse({
			requestId: "never-resolves",
			assetId: "synthetic/never",
			priority: "streaming",
		});
		await waitForMicrotasks();
		controller.dispose();

		await expect(response).rejects.toThrow(
			"Asset channel was disposed before preparation completed.",
		);
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

	it("prepares gfx-obj payloads and duplicates CullMode.None backfaces", () => {
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
			vertexCount: 12,
			triangleCount: 4,
			skippedPolygonCount: 0,
			surfaceIds: [0x08000001],
			bounds: {
				min: { x: 0, y: 0, z: -2 },
				max: { x: 2, y: 0, z: 0 },
			},
		});
		expect(gfxObj.payload.renderGeometry.positions).toEqual([
			0, 0, 0, 2, 0, 0, 2, 0, -2, 0, 0, 0, 2, 0, -2, 0, 0, -2, 0, 0, 0, 2, 0,
			-2, 2, 0, 0, 0, 0, 0, 0, 0, -2, 2, 0, -2,
		]);
		expect(gfxObj.payload.renderGeometry.normals).toEqual([
			0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0,
			0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
		]);
		expect(gfxObj.payload.renderGeometry.uvs).toEqual([
			0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1,
		]);
		expect(gfxObj.payload.renderGeometry.triangles).toEqual([
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 0 },
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 3 },
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 6 },
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 9 },
		]);
		expect(gfxObj.payload.physicsWitness).toEqual({
			polygonCount: 2,
			hasBsp: true,
		});
	});

	it("excludes GfxObj drawing BSP portal apertures from render geometry", () => {
		const gfxObj = prepareAssetPayload(
			{
				requestId: "gfx-obj-with-portal-aperture",
				assetId: "gfx-obj/01000003",
				priority: "streaming",
			},
			{
				requestId: "gfx-obj-with-portal-aperture",
				assetId: "gfx-obj/01000003",
				payloadKind: "json",
				payload: {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x01000003,
					flags: 3,
					surfaceIds: [0x08000001, 0x08000002],
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
							numPts: 3,
							stippling: 0x08,
							sidesType: 2,
							posSurface: 0x08000001,
							negSurface: 0,
							vertexIds: [0, 1, 2],
							posUvIndices: [0, 0, 0],
							negUvIndices: [],
						},
						{
							id: 2,
							numPts: 3,
							stippling: 0x08,
							sidesType: 2,
							posSurface: 0x08000002,
							negSurface: 0,
							vertexIds: [0, 2, 3],
							posUvIndices: [0, 0, 0],
							negUvIndices: [],
						},
					],
					drawingBsp: {
						kind: "port",
						plane: {
							normal: { x: 0, y: 1, z: 0 },
							d: 0,
						},
						pos: {
							kind: "leaf",
							index: 0,
							solid: 0,
							sphere: null,
							polyIds: [],
						},
						neg: {
							kind: "leaf",
							index: 1,
							solid: 0,
							sphere: null,
							polyIds: [],
						},
						sphere: null,
						polyIds: [1],
						portalPolys: [{ portalIndex: 0, polyId: 2 }],
					},
					physicsWitness: {
						polygonCount: 0,
						hasBsp: false,
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
			},
		);

		expect(gfxObj.payload.kind).toBe("gfx-obj");
		if (gfxObj.payload.kind !== "gfx-obj") {
			throw new Error("expected gfx-obj payload");
		}
		expect(gfxObj.payload.renderGeometry).toMatchObject({
			vertexCount: 3,
			triangleCount: 1,
			skippedPolygonCount: 0,
			surfaceIds: [0x08000001],
		});
		expect(gfxObj.payload.renderGeometry.triangles).toEqual([
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 0 },
		]);
	});

	it("prepares counter-clockwise culled gfx-obj polygons with reversed positive winding", () => {
		const gfxObj = prepareAssetPayload(
			{
				requestId: "gfx-obj-ccw-cull",
				assetId: "gfx-obj/01000002",
				priority: "streaming",
			},
			{
				requestId: "gfx-obj-ccw-cull",
				assetId: "gfx-obj/01000002",
				payloadKind: "json",
				payload: {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x01000002,
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
							sidesType: 3,
							posSurface: 0x08000001,
							negSurface: 0,
							vertexIds: [0, 1, 2],
							posUvIndices: [0, 0, 0],
							negUvIndices: [],
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
						detail: "dats/assets.hba",
					},
				},
			},
		);

		expect(gfxObj.payload.kind).toBe("gfx-obj");
		if (gfxObj.payload.kind !== "gfx-obj") {
			throw new Error("expected gfx-obj payload");
		}
		expect(gfxObj.payload.renderGeometry).toMatchObject({
			vertexCount: 3,
			triangleCount: 1,
			skippedPolygonCount: 0,
			surfaceIds: [0x08000001],
		});
		expect(gfxObj.payload.renderGeometry.positions).toEqual([
			0, 0, 0, 0, 0, -2, 2, 0, 0,
		]);
		expect(gfxObj.payload.renderGeometry.normals).toEqual([
			0, -1, 0, 0, -1, 0, 0, -1, 0,
		]);
		expect(gfxObj.payload.renderGeometry.uvs).toEqual([0, 0, 0, 1, 1, 0]);
		expect(gfxObj.payload.renderGeometry.triangles).toEqual([
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 0 },
		]);
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
			vertexCount: 6,
			triangleCount: 2,
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
			{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 3 },
		]);
	});

	it("renders gfx-obj polygons that omit positive UV indices", () => {
		const gfxObj = prepareAssetPayload(
			{
				requestId: "gfx-obj-uvless-positive",
				assetId: "gfx-obj/010010ce",
				priority: "streaming",
			},
			{
				requestId: "gfx-obj-uvless-positive",
				assetId: "gfx-obj/010010ce",
				payloadKind: "json",
				payload: {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x010010ce,
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
								uvs: [],
							},
							{
								id: 1,
								origin: { x: 2, y: 0, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [],
							},
							{
								id: 2,
								origin: { x: 2, y: 2, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [],
							},
							{
								id: 3,
								origin: { x: 0, y: 2, z: 0 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [],
							},
						],
					},
					drawingPolygons: [
						{
							id: 1,
							numPts: 4,
							stippling: 0x04,
							sidesType: 0,
							posSurface: 0,
							negSurface: -1,
							vertexIds: [0, 1, 2, 3],
							posUvIndices: [],
							negUvIndices: [],
						},
					],
					drawingBsp: null,
					physicsWitness: {
						polygonCount: 0,
						hasBsp: false,
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
			},
		);

		expect(gfxObj.payload.kind).toBe("gfx-obj");
		if (gfxObj.payload.kind !== "gfx-obj") {
			throw new Error("expected gfx-obj payload");
		}
		expect(gfxObj.payload.renderGeometry).toMatchObject({
			vertexCount: 6,
			triangleCount: 2,
			skippedPolygonCount: 0,
			surfaceIds: [],
		});
		expect(gfxObj.payload.renderGeometry.uvs).toEqual([
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		]);
		expect(gfxObj.payload.renderGeometry.triangles).toEqual([
			{ polygonId: 1, surfaceId: null, firstVertex: 0 },
			{ polygonId: 1, surfaceId: null, firstVertex: 3 },
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

function createPreparedLandblockPackAsset(
	landblockId: number,
	staticMeshes: PreparedLandblockStaticMesh[] = [],
): PreparedAssetRecord {
	const normalizedLandblockId = ((landblockId & 0xffff0000) | 0xffff) >>> 0;
	const assetId = `landblock-pack/${normalizedLandblockId.toString(16).padStart(8, "0")}`;
	const payload: PreparedAssetRecord["payload"] = {
		kind: "landblock-pack",
		sourceAssetKind: "landblock-pack",
		residencyKind: "landblock",
		landblockId: normalizedLandblockId,
		landblockInfoId: (normalizedLandblockId & 0xffff0000) | 0xfffe,
		classification: "outdoor",
		sourceFacts: {
			buildings: [],
		},
		prepared: {
			terrainMesh: null,
			outdoorStaticInstances: [],
			interiorCells: [],
			staticMeshes,
			spatialItems: [],
			staticLandblockBvh: null,
		},
		dependencies: {
			cellDatIds: [],
			portalDatIds: [],
			renderableAssetIds: [],
		},
		diagnostics: { sourceRecords: [], errors: [] },
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "landblock-pack",
			errorCode: null,
			detail: "test-cache",
		},
	};
	return {
		request: {
			requestId: `cached-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `cached-${assetId}`,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-20T00:00:00.000Z",
	};
}

function createPreparedLandblockSummaryAsset(
	landblockId: number,
	sourceAssetId: string,
): PreparedAssetRecord {
	const normalizedLandblockId = ((landblockId & 0xffff0000) | 0xffff) >>> 0;
	const assetId = `landblock-summary/${normalizedLandblockId.toString(16).padStart(8, "0")}`;
	const sourceDid = Number.parseInt(sourceAssetId.slice(-8), 16);
	const payload: PreparedAssetRecord["payload"] = {
		kind: "landblock-summary",
		sourceAssetKind: "landblock-summary",
		residencyKind: "landblock",
		landblockId: normalizedLandblockId,
		landblockInfoId: (normalizedLandblockId & 0xffff0000) | 0xfffe,
		classification: "outdoor",
		sourceFacts: {
			buildings: [
				{
					instanceId: `summary-building/${sourceAssetId}`,
					owningLandblockId: normalizedLandblockId,
					sourceDid,
					sourceAssetId,
					sourceIndex: 0,
					localPlacement: {
						origin: { x: 0, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
					numLeaves: 0,
					portals: [],
				},
			],
		},
		prepared: { terrainMesh: null },
		dependencies: {
			cellDatIds: [],
			renderableAssetIds: [sourceAssetId],
		},
		diagnostics: { sourceRecords: [], errors: [] },
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "landblock-summary",
			errorCode: null,
			detail: "test-cache",
		},
	};
	return {
		request: {
			requestId: `cached-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `cached-${assetId}`,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-20T00:00:00.000Z",
	};
}

function createPreparedLandblockStaticMesh(
	owningLandblockId: number,
	sourceAssetId: string,
	gfxObjAssetId: string,
	kind: "scenery" | "building" | "generated-scenery" = "scenery",
): PreparedLandblockStaticMesh {
	const sourceDid = Number.parseInt(sourceAssetId.slice(-8), 16);
	const gfxObjId = Number.parseInt(gfxObjAssetId.slice(-8), 16);
	return {
		instanceId: `pack-static/${kind}/${sourceAssetId}`,
		kind,
		owningLandblockId,
		owningEnvCellId: null,
		sourceDid,
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		sourceScale: { x: 1, y: 1, z: 1 },
		partIndex: 0,
		gfxObjId,
		gfxObjAssetId,
		partPlacements: [],
		partScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
	};
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
