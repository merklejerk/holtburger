import { describe, expect, it } from "vitest";

import { createInitialAssetChannelState } from "../assets/types";
import { deriveVerticalSliceReport } from "./report";
import type { HostBoundarySnapshot } from "../host/contracts";

function createSnapshot(): HostBoundarySnapshot {
	return {
		source: "tauri",
		lifecycleState: {
			phase: "ready",
			activeModeHint: "browser",
			sessionState: "unavailable",
			summary: "ready",
		},
		runtimeBatch: {
			tick: 6,
			entities: [
				{
					entityId: 0x01020304,
					label: "Browser Scout",
					position: { x: 0, y: 0, z: 0 },
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
				focusLocationLabel: "100.40S, 101.55W, 1.0Z",
				indoors: false,
				trackedBodyCount: 1,
			},
		},
		viewModelFeed: {
			selectedEntityId: 0x01020304,
			interactionMode: "inspect",
			busyState: "idle",
		},
		overview: {
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			notes: [],
		},
	};
}

describe("vertical slice report", () => {
	it("summarizes bootstrap and streaming asset preparation separately", () => {
		const report = deriveVerticalSliceReport(createSnapshot(), {
			...createInitialAssetChannelState(),
			preparedByPriority: {
				bootstrap: {
					request: {
						requestId: "bootstrap-1-gfx/02000001",
						assetId: "gfx/02000001",
						priority: "bootstrap",
					},
					response: {
						requestId: "bootstrap-1-gfx/02000001",
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
				streaming: {
					request: {
						requestId: "streaming-2-gfx/02000003",
						assetId: "gfx/02000003",
						priority: "streaming",
					},
					response: {
						requestId: "streaming-2-gfx/02000003",
						assetId: "gfx/02000003",
						payloadKind: "json",
						payload: { kind: "appearance-manifest" },
					},
					residencyKind: "indoor-env-cell",
					debugPrimitive: "sentinel-proxy-volume",
					paletteKey: "dungeon-sentinel",
					summary: "Prepared gfx/02000003 as sentinel-proxy-volume for indoor-env-cell.",
					notes: [],
					preparedAt: "2026-04-26T00:00:01.000Z",
				},
				prefetch: null,
			},
			history: [
				{
					requestId: "bootstrap-1-gfx/02000001",
					assetId: "gfx/02000001",
					priority: "bootstrap",
					status: "prepared",
					channel: "asset",
					summary: "Prepared gfx/02000001 as survey-billboard for outdoor-landblock.",
					timestamp: "2026-04-26T00:00:00.000Z",
				},
				{
					requestId: "streaming-2-gfx/02000003",
					assetId: "gfx/02000003",
					priority: "streaming",
					status: "prepared",
					channel: "asset",
					summary: "Prepared gfx/02000003 as sentinel-proxy-volume for indoor-env-cell.",
					timestamp: "2026-04-26T00:00:01.000Z",
				},
			],
		});

		expect(report.headline).toMatch(/live host/);
		expect(report.assetSummary).toMatch(/bootstrap plus streaming/);
		expect(report.observedFlows).toContain("Bootstrap asset: gfx/02000001.");
		expect(report.observedFlows).toContain("Streaming asset: gfx/02000003.");
		expect(report.awkwardSeams[0]).toMatch(/Asset payloads are still typed appearance manifests/);
	});
});
