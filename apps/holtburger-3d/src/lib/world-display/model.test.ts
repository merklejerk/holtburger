import { describe, expect, it } from "vitest";

import {
	buildCameraHint,
	buildRayPickRequest,
	deriveTerrainViewport,
	deriveWorldDisplayModel,
	normalizeViewportPoint,
	shouldSendThrottledCameraHint,
} from "./model";
import { createInitialAssetChannelState } from "../assets/types";
import type { RuntimeBatchDto } from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 7,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 0,
		},
	};
}

describe("world display model helpers", () => {
	it("derives a world-shell model from the runtime batch and browser destination", () => {
		const model = deriveWorldDisplayModel({
			activeModeLabel: "World Viewer",
			hostStatus: "Connected to the host.",
			runtimeBatch: createRuntimeBatch(),
			viewModelFeed: {
				selectedEntityId: null,
				interactionMode: "inspect",
				busyState: "idle",
			},
			assetState: {
				...createInitialAssetChannelState(),
				status: "ready",
				activeRequest: {
					requestId: "fixture",
					assetId: "gfx/02000001",
					priority: "bootstrap",
				},
				preparedAsset: {
					assetKind: "terrain-landblock",
					request: {
						requestId: "fixture",
						assetId: "terrain/0102ffff",
						priority: "bootstrap",
					},
					response: {
						requestId: "fixture",
						assetId: "terrain/0102ffff",
						payloadKind: "json",
						payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
					},
					residencyKind: "outdoor-landblock",
					debugPrimitive: "terrain-landblock-mesh",
					paletteKey: "terrain-0102ffff",
					provenance: {
						source: "unknown",
						sourceAssetKind: "cell-landblock",
						errorCode: null,
						detail: null,
					},
					terrainMesh: {
						landblockId: 0x0102ffff,
						gridSize: 9,
						tileSize: 24,
						vertices: Array.from({ length: 81 }, (_, index) => ({
							x: (index % 9) * 24,
							y: Math.floor(index / 9) * 24,
							z: index % 12,
						})),
						triangles: Array.from({ length: 128 }, (_, index) => ({
							a: index % 40,
							b: (index % 40) + 1,
							c: (index % 40) + 9,
							terrainType: index % 6,
							averageHeight: (index % 10) + 2,
						})),
						minHeight: 0,
						maxHeight: 11,
					},
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
				lastResponse: {
					requestId: "fixture",
					assetId: "terrain/0102ffff",
					payloadKind: "json",
					payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
				},
				errorMessage: null,
			},
			browserDestination: {
				label: "100.55S, 101.65W, 2.0Z",
				northSouth: 100.55,
				northSouthHemisphere: "S",
				eastWest: 101.65,
				eastWestHemisphere: "W",
				elevation: 2,
				source: "manual",
			},
			cameraAck: null,
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.headline).toMatch(/manual destination/i);
		expect(model.destinationLabel).toBe("100.55S, 101.65W, 2.0Z");
		expect(model.entities).toHaveLength(0);
		expect(model.sceneContext.kind).toBe("outdoor-landblock-ring");
		expect(model.sceneContext.chunks).toHaveLength(6);
		expect(model.sceneContext.focusLandblockLabel).toBe("0x0001ffff");
		expect(model.terrainContract.requestKey).toBe("terrain/0001ffff");
		expect(model.terrainContract.decodeOwner).toBe("rust-host-adapter");
		expect(model.renderCacheText).toMatch(/authoritative residency/);
		expect(model.assetText).toMatch(/Prepared terrain\/0102ffff/);
	});

	it("projects a prepared terrain mesh into viewport polygons", () => {
		const viewport = deriveTerrainViewport({
			request: {
				requestId: "fixture",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			},
			response: {
				requestId: "fixture",
				assetId: "terrain/0102ffff",
				payloadKind: "json",
				payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
			},
			assetKind: "terrain-landblock",
			residencyKind: "outdoor-landblock",
			debugPrimitive: "terrain-landblock-mesh",
			paletteKey: "terrain-0102ffff",
			provenance: {
				source: "unknown",
				sourceAssetKind: "cell-landblock",
				errorCode: null,
				detail: null,
			},
			terrainMesh: {
				landblockId: 0x0102ffff,
				gridSize: 9,
				tileSize: 24,
				vertices: Array.from({ length: 81 }, (_, index) => ({
					x: (index % 9) * 24,
					y: Math.floor(index / 9) * 24,
					z: (index % 9) + Math.floor(index / 9),
				})),
				triangles: [
					{ a: 0, b: 9, c: 1, terrainType: 1, averageHeight: 4 },
					{ a: 1, b: 9, c: 10, terrainType: 2, averageHeight: 5 },
				],
				minHeight: 0,
				maxHeight: 12,
			},
			preparedAt: "2026-04-26T00:00:00.000Z",
		});

		expect(viewport.ready).toBe(true);
		expect(viewport.landblockLabel).toBe("0x0102ffff");
		expect(viewport.polygons).toHaveLength(2);
		expect(viewport.polygons[0].points).toMatch(/,/);
	});

	it("makes the outdoor-first limit explicit when runtime residency is indoors", () => {
		const runtimeBatch = createRuntimeBatch();
		runtimeBatch.residency.indoors = true;
		runtimeBatch.residency.focusLandblockId = 0x016c0155;

		const model = deriveWorldDisplayModel({
			activeModeLabel: "World Viewer",
			hostStatus: "Connected to the host.",
			runtimeBatch,
			viewModelFeed: null,
			assetState: createInitialAssetChannelState(),
			browserDestination: null,
			cameraAck: null,
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.sceneContext.kind).toBe("indoor-gap");
		expect(model.sceneContext.chunks).toHaveLength(0);
		expect(model.sceneContext.gapText).toMatch(/visible-cell/i);
		expect(model.terrainContract.requestKey).toBeNull();
	});

	it("builds camera hints and pick requests from viewport input", () => {
		const cameraHint = buildCameraHint(
			"client",
			createRuntimeBatch(),
			null,
			normalizeViewportPoint(180, 60, 240, 120),
		);

		expect(cameraHint).not.toBeNull();
		expect(cameraHint?.mode).toBe("client");
		expect(cameraHint?.viewportNormalizedX).toBeCloseTo(0.75);
		expect(cameraHint?.destinationLabel).toBe("100.40S, 101.55W, 1.0Z");

		const request = buildRayPickRequest(cameraHint!, "pick-1");

		expect(request.requestId).toBe("pick-1");
		expect(request.origin).toEqual(cameraHint?.position);
		expect(request.direction).toEqual(cameraHint?.forward);
	});

	it("throttles camera hints on a fixed minimum interval", () => {
		expect(shouldSendThrottledCameraHint(null, 1000)).toBe(true);
		expect(shouldSendThrottledCameraHint(1000, 1120)).toBe(false);
		expect(shouldSendThrottledCameraHint(1000, 1250)).toBe(true);
	});
});
