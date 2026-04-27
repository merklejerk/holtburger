import { describe, expect, it } from "vitest";

import {
	AssetChannelController,
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
	FrontendStateFeedDto,
	RuntimeBatchDto,
} from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 4,
		entities: [
			{
				entityId: 0x01020304,
				label: "Browser Scout",
				position: { x: 12, y: -4.5, z: 1 },
				headingRadians: 0,
				visualAssetId: "gfx/02000001",
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
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 1,
		},
	};
}

function createViewModelFeed(selectedEntityId = 0x01020304): FrontendStateFeedDto {
	return {
		selectedEntityId,
		interactionMode: "inspect",
		busyState: "idle",
	};
}

class FakeAssetWorker implements AssetWorkerLike {
	onmessage: ((event: MessageEvent<AssetWorkerResponseMessage>) => void) | null =
		null;
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
						visualAssetId: "gfx/02000003",
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
					assetKind: "terrain-landblock",
					residencyKind: "outdoor-landblock",
					debugPrimitive: "terrain-landblock-mesh",
					paletteKey: "terrain-0102ffff",
					terrainMesh: {
						landblockId: 0x0102ffff,
						gridSize: 9,
						tileSize: 24,
						vertices: [],
						triangles: [],
						minHeight: 0,
						maxHeight: 12,
					},
					summary: "focus",
					notes: [],
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
					assetKind: "terrain-landblock",
					residencyKind: "outdoor-landblock",
					debugPrimitive: "terrain-landblock-mesh",
					paletteKey: "terrain-0102ffff",
					terrainMesh: {
						landblockId: 0x0102ffff,
						gridSize: 9,
						tileSize: 24,
						vertices: [],
						triangles: [],
						minHeight: 0,
						maxHeight: 12,
					},
					summary: "focus",
					notes: [],
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
			},
			[],
		);

		expect(requests).toHaveLength(8);
		expect(requests.every((request) => request.assetId !== "terrain/0102ffff")).toBe(true);
	});

	it("excludes already in-flight terrain assets from the immediate coverage enqueue set", () => {
		const requests = createTerrainCoverageRequests(
			createRuntimeBatch(),
			null,
			"streaming",
			{},
			["terrain/0102ffff", "terrain/0101ffff"],
		);

		expect(requests.some((request) => request.assetId === "terrain/0102ffff")).toBe(false);
		expect(requests.some((request) => request.assetId === "terrain/0101ffff")).toBe(false);
		expect(requests).toHaveLength(7);
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
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					heights: Array.from({ length: 81 }, (_, index) => index % 9),
					terrainTypes: Array.from({ length: 81 }, (_, index) => index % 6),
					notes: ["Prepared in a fake worker for test coverage."],
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
		expect(preparedAsset.assetKind).toBe("terrain-landblock");
		expect(preparedAsset.residencyKind).toBe("outdoor-landblock");
		expect(preparedAsset.summary).toMatch(/Prepared terrain\/0102ffff/);
		expect(preparedAsset.terrainMesh?.triangles).toHaveLength(128);
		expect(preparedAsset.response.payloadKind).toBe("json");

		controller.dispose();
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
					landblockId: 0x0102ffff,
					gridSize: 9,
					tileSize: 24,
					heights: Array.from({ length: 81 }, (_, index) => index),
					terrainTypes: Array.from({ length: 81 }, (_, index) => index),
					notes: ["Prepared in a fake worker for ordering coverage."],
				},
			},
		);

		expect(preparedAsset.terrainMesh?.vertices[0]?.z).toBe(0);
		expect(preparedAsset.terrainMesh?.vertices[1]?.z).toBe(9);
		expect(preparedAsset.terrainMesh?.vertices[9]?.z).toBe(1);
		expect(preparedAsset.terrainMesh?.triangles[0]?.terrainType).toBe(0);
		expect(preparedAsset.terrainMesh?.triangles[2]?.terrainType).toBe(9);
	});
});