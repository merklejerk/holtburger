import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CameraHintAckDto,
	CameraHintDto,
	FrontendStateFeedDto,
	HostBoundaryOverviewDto,
	LifecycleStateDto,
	RayPickResponseDto,
	RuntimeBatchDto,
	RuntimeNotificationEnvelopeDto,
	RuntimeResidencyDto,
} from "./contracts";

describe("host contracts", () => {
	it("keeps the stable runtime contract fields visible to TypeScript tests", () => {
		const lifecycleState: LifecycleStateDto = {
			phase: "ready",
			activeModeHint: "browser",
			sessionState: "disconnected",
			summary: "Ready for browser mode.",
		};
		const residency: RuntimeResidencyDto = {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 2,
		};
		const runtimeBatch: RuntimeBatchDto = {
			tick: 1,
			entities: [
				{
					entityId: 0x01020304,
					label: "Browser Scout",
					position: { x: 12, y: -4.5, z: 1 },
					headingRadians: 0,
					appearanceId: "gfx/02000001",
					landblockId: residency.focusLandblockId,
					cellId: residency.focusCellId,
					locationLabel: residency.focusLocationLabel,
					isLocalPlayer: true,
				},
			],
			residency,
		};
		const viewModelFeed: FrontendStateFeedDto = {
			selectedEntityId: 0x01020304,
			interactionMode: "inspect",
			busyState: "idle",
		};
		const notification: RuntimeNotificationEnvelopeDto = {
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState,
			runtimeBatch,
			viewModelFeed,
		};

		expect(notification.lifecycleState?.phase).toBe("ready");
		expect(notification.runtimeBatch?.residency.focusLocationLabel).toBe(
			"100.40S, 101.55W, 1.0Z",
		);
		expect(notification.viewModelFeed?.interactionMode).toBe("inspect");
	});

	it("keeps the asset channel contract distinct from runtime snapshot typing", () => {
		const request: AssetLookupRequestDto = {
			requestId: "bootstrap-asset",
			assetId: "gfx/02000001",
			priority: "bootstrap",
		};
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "appearance-manifest",
				residencyKind: "outdoor-landblock",
			},
		};
		const overview: HostBoundaryOverviewDto = {
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			notes: [],
		};

		expect(overview.assetChannel).toBe("asset");
		expect(response.assetId).toBe(request.assetId);
		expect(response.payload).toMatchObject({
			kind: "appearance-manifest",
		});
	});

	it("keeps camera-hint and authority-sensitive pick contracts typed", () => {
		const cameraHint: CameraHintDto = {
			mode: "browser",
			source: "world-display",
			position: { x: 12, y: -4.5, z: 1 },
			forward: { x: 0, y: 1, z: 0 },
			viewportNormalizedX: 0.5,
			viewportNormalizedY: 0.5,
			destinationLabel: "100.40S, 101.55W, 1.0Z",
		};
		const cameraAck: CameraHintAckDto = {
			accepted: true,
			sequence: 3,
			summary: "Accepted camera hint.",
		};
		const response: RayPickResponseDto = {
			requestId: "pick-1",
			resolved: true,
			cameraHintSequence: cameraAck.sequence,
			hit: {
				entityId: 0x01020304,
				label: "Browser Scout",
				locationLabel: "100.40S, 101.55W, 1.0Z",
				distance: 14.5,
			},
			summary: "Resolved pick.",
		};

		expect(cameraHint.destinationLabel).toMatch(/Z$/);
		expect(response.cameraHintSequence).toBe(cameraAck.sequence);
		expect(response.hit?.label).toBe("Browser Scout");
	});
});
