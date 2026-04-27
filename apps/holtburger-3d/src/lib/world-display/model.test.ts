import { describe, expect, it } from "vitest";

import {
	buildCameraHint,
	buildRayPickRequest,
	deriveWorldDisplayModel,
	normalizeViewportPoint,
	shouldSendThrottledCameraHint,
} from "./model";
import { createInitialAssetChannelState } from "../assets/types";
import type { RuntimeBatchDto } from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 7,
		entities: [
			{
				entityId: 0x01020304,
				label: "Browser Scout",
				position: { x: 10, y: 15, z: 2 },
				headingRadians: 0.25,
				visualAssetId: "gfx/02000001",
				landblockId: 0x01020003,
				cellId: 3,
				locationLabel: "100.40S, 101.55W, 1.0Z",
				isLocalPlayer: true,
			},
			{
				entityId: 0x01020305,
				label: "Survey Drudge",
				position: { x: 22, y: 30, z: 0 },
				headingRadians: 1.1,
				visualAssetId: "gfx/02000002",
				landblockId: 0x0102001b,
				cellId: 27,
				locationLabel: "100.41S, 101.52W, 0.0Z",
				isLocalPlayer: false,
			},
		],
		residency: {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 2,
		},
	};
}

describe("world display model helpers", () => {
	it("derives a world-shell summary from the runtime batch and browser destination", () => {
		const model = deriveWorldDisplayModel({
			activeModeLabel: "Browser Mode",
			hostStatus: "Connected to the host.",
			runtimeBatch: createRuntimeBatch(),
			viewModelFeed: {
				selectedEntityId: 0x01020305,
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
					request: {
						requestId: "fixture",
						assetId: "gfx/02000001",
						priority: "bootstrap",
					},
					response: {
						requestId: "fixture",
						assetId: "gfx/02000001",
						payloadKind: "json",
						payload: { kind: "appearance-manifest" },
					},
					residencyKind: "outdoor-landblock",
					debugPrimitive: "survey-billboard",
					paletteKey: "bronze-scout",
					summary: "Prepared gfx/02000001 as survey-billboard for outdoor-landblock.",
					notes: [],
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
				lastResponse: {
					requestId: "fixture",
					assetId: "gfx/02000001",
					payloadKind: "json",
					payload: { kind: "appearance-manifest" },
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

		expect(model.headline).toMatch(/destination preview/i);
		expect(model.destinationLabel).toBe("100.55S, 101.65W, 2.0Z");
		expect(model.entities).toHaveLength(2);
		expect(model.sceneContext.kind).toBe("outdoor-landblock-ring");
		expect(model.sceneContext.chunks).toHaveLength(9);
		expect(model.sceneContext.focusLandblockLabel).toBe("0x0102ffff");
		expect(model.terrainContract.requestKey).toBe("terrain/0102ffff");
		expect(model.terrainContract.decodeOwner).toBe("rust-host-adapter");
		expect(model.entities.find((entity) => entity.isSelected)?.label).toBe(
			"Survey Drudge",
		);
		expect(model.assetSummary).toMatch(/Prepared gfx\/02000001/);
	});

	it("makes the outdoor-first limit explicit when runtime residency is indoors", () => {
		const runtimeBatch = createRuntimeBatch();
		runtimeBatch.residency.indoors = true;
		runtimeBatch.residency.focusLandblockId = 0x016c0155;

		const model = deriveWorldDisplayModel({
			activeModeLabel: "Browser Mode",
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
		expect(model.sceneContext.gapSummary).toMatch(/visible-cell/i);
		expect(model.terrainContract.requestKey).toBeNull();
	});

	it("builds camera hints and pick requests from viewport input", () => {
		const cameraHint = buildCameraHint(
			"browser",
			createRuntimeBatch(),
			null,
			normalizeViewportPoint(180, 60, 240, 120),
		);

		expect(cameraHint).not.toBeNull();
		expect(cameraHint?.mode).toBe("browser");
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
