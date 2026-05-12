import { describe, expect, it } from "vitest";

import {
	AssetChannelController,
	createSceneCoverageRequests,
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
				label: "29.90S, 65.90W, 0.0Z",
				northSouth: 29.9,
				northSouthHemisphere: "S",
				eastWest: 65.9,
				eastWestHemisphere: "W",
				elevation: 0,
				source: "manual",
			},
			"streaming",
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).toBe("terrain/2d5affff");
		expect(request?.priority).toBe("streaming");
	});

	it("derives destination terrain focus from browser coordinates when present", () => {
		const landblockId = deriveTerrainFocusLandblockId(createRuntimeBatch(), {
			label: "29.90S, 65.90W, 0.0Z",
			northSouth: 29.9,
			northSouthHemisphere: "S",
			eastWest: 65.9,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
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
			"cell-structure/0001",
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
					visibleCellIds: [0x016c0156],
					seenOutside: false,
					surfaceIds: [0x08000001],
					portalCount: 2,
					staticObjectCount: 1,
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
					cellStructureIds: [],
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
		expect(indoorEnvCell.payload.debugPresentation.primitive).toBe(
			"indoor-env-cell-metadata",
		);
		expect(environment.payload.kind).toBe("environment");
		if (environment.payload.kind !== "environment") {
			throw new Error("expected environment payload");
		}
		expect(environment.payload.debugPresentation.primitive).toBe(
			"environment-reference",
		);
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
						vertexCount: 3,
						vertices: [],
					},
					drawingPolygons: [
						{
							id: 1,
							numPts: 3,
							stippling: 0,
							sidesType: 1,
							posSurface: 0,
							negSurface: 0,
							vertexIds: [0, 1, 2],
							posUvIndices: [0, 0, 0],
							negUvIndices: [0, 0, 0],
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
		expect(gfxObj.payload.vertexArray.vertexCount).toBe(3);
		expect(gfxObj.payload.drawingPolygons).toHaveLength(1);
		expect(gfxObj.payload.physicsWitness).toEqual({
			polygonCount: 2,
			hasBsp: true,
		});
	});
});

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
