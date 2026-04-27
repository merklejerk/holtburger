import { describe, expect, it } from "vitest";

import {
	AssetChannelController,
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
			createViewModelFeed(),
			"bootstrap",
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).toBe("gfx/02000001");
		expect(request?.priority).toBe("bootstrap");
	});

	it("uses the selected runtime entity for streaming asset refreshes", () => {
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
			createViewModelFeed(0x01020305),
			"streaming",
		);

		expect(request).not.toBeNull();
		expect(request?.assetId).toBe("gfx/02000003");
		expect(request?.priority).toBe("streaming");
	});

	it("prepares a looked-up asset through the worker before returning it to the frontend", async () => {
		const controller = new AssetChannelController(
			async (request) => ({
				requestId: request.requestId,
				assetId: request.assetId,
				payloadKind: "json",
				payload: {
					kind: "appearance-manifest",
					residencyKind: "outdoor-landblock",
					debugPrimitive: "survey-billboard",
					paletteKey: "bronze-scout",
					notes: ["Prepared in a fake worker for test coverage."],
				},
			}),
			() => new FakeAssetWorker(),
		);

		const preparedAsset = await controller.prepareAsset({
			requestId: "bootstrap-4-gfx/02000001",
			assetId: "gfx/02000001",
			priority: "bootstrap",
		});

		expect(preparedAsset.request.assetId).toBe("gfx/02000001");
		expect(preparedAsset.residencyKind).toBe("outdoor-landblock");
		expect(preparedAsset.summary).toMatch(/Prepared gfx\/02000001/);
		expect(preparedAsset.response.payloadKind).toBe("json");

		controller.dispose();
	});
});