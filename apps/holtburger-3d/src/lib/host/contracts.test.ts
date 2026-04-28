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
import {
	hostBoundaryOverviewDtoSchema,
	runtimeNotificationEnvelopeDtoSchema,
} from "./contracts";

describe("host contracts", () => {
	it("keeps the stable runtime contract fields visible to TypeScript tests", () => {
		const lifecycleState: LifecycleStateDto = {
			phase: "ready",
			activeModeHint: "client",
			sessionState: "disconnected",
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
			assetId: "terrain/0102ffff",
			priority: "bootstrap",
		};
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				landblockId: 0x0102ffff,
			},
		};
		const overview: HostBoundaryOverviewDto = {
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			indoorContractBacklog: {
				runtimeFieldIds: [
					"focus-env-cell-id",
					"visible-cell-ids",
					"seen-outside",
					"environment-id",
					"cell-structure-id",
				],
				assetFamilyIds: [
					"indoor-env-cell",
					"environment",
					"cell-structure",
				],
			},
		};

		expect(overview.assetChannel).toBe("asset");
		expect(overview.indoorContractBacklog.runtimeFieldIds).toContain(
			"visible-cell-ids",
		);
		expect(overview.indoorContractBacklog.assetFamilyIds).toContain(
			"cell-structure",
		);
		expect(response.assetId).toBe(request.assetId);
		expect(response.payload).toMatchObject({
			kind: "terrain-landblock",
		});
	});

	it("keeps camera-hint and authority-sensitive pick contracts typed", () => {
		const cameraHint: CameraHintDto = {
			mode: "client",
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
		};

		expect(cameraHint.destinationLabel).toMatch(/Z$/);
		expect(response.cameraHintSequence).toBe(cameraAck.sequence);
		expect(response.hit?.label).toBe("Browser Scout");
	});

	it("parses raw runtime notifications and host overview payloads through zod schemas", () => {
		const notification = runtimeNotificationEnvelopeDtoSchema.parse({
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState: null,
			runtimeBatch: {
				tick: 1,
				entities: [],
				residency: {
					focusEntityId: null,
					focusLandblockId: 0x0102ffff,
					focusCellId: null,
					focusLocationLabel: "100.40S, 101.55W, 1.0Z",
					indoors: false,
					trackedBodyCount: 0,
				},
			},
			viewModelFeed: {
				selectedEntityId: null,
				interactionMode: "inspect",
				busyState: "idle",
			},
		});
		const overview = hostBoundaryOverviewDtoSchema.parse({
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			indoorContractBacklog: {
				runtimeFieldIds: ["visible-cell-ids"],
				assetFamilyIds: ["cell-structure"],
			},
		});

		expect(notification.runtimeBatch?.tick).toBe(1);
		expect(overview.indoorContractBacklog.assetFamilyIds).toContain("cell-structure");
	});

	it("rejects malformed runtime notifications instead of trusting invoke generics", () => {
		expect(() =>
			runtimeNotificationEnvelopeDtoSchema.parse({
				channel: "runtime",
				topic: "runtime.batch",
				lifecycleState: null,
				runtimeBatch: {
					tick: "one",
					entities: [],
					residency: null,
				},
				viewModelFeed: null,
			}),
		).toThrow();
	});
});
