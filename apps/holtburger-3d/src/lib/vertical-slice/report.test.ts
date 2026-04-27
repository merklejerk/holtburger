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
			entities: [],
			residency: {
				focusEntityId: null,
				focusLandblockId: 0x01020003,
				focusCellId: 3,
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
					assetKind: "terrain-landblock",
					request: {
						requestId: "bootstrap-1-runtime-terrain/0102ffff",
						assetId: "terrain/0102ffff",
						priority: "bootstrap",
					},
					response: {
						requestId: "bootstrap-1-runtime-terrain/0102ffff",
						assetId: "terrain/0102ffff",
						payloadKind: "json",
						payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
					},
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
						maxHeight: 30,
					},
					summary: "Prepared terrain/0102ffff as a landblock terrain mesh with 81 vertices and 128 triangles.",
					notes: [],
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
				streaming: {
					assetKind: "terrain-landblock",
					request: {
						requestId: "streaming-2-runtime-terrain/0103ffff",
						assetId: "terrain/0103ffff",
						priority: "streaming",
					},
					response: {
						requestId: "streaming-2-runtime-terrain/0103ffff",
						assetId: "terrain/0103ffff",
						payloadKind: "json",
						payload: { kind: "terrain-landblock", landblockId: 0x0103ffff },
					},
					residencyKind: "outdoor-landblock",
					debugPrimitive: "terrain-landblock-mesh",
					paletteKey: "terrain-0103ffff",
					terrainMesh: {
						landblockId: 0x0103ffff,
						gridSize: 9,
						tileSize: 24,
						vertices: [],
						triangles: [],
						minHeight: 2,
						maxHeight: 24,
					},
					summary: "Prepared terrain/0103ffff as a landblock terrain mesh with 81 vertices and 128 triangles.",
					notes: [],
					preparedAt: "2026-04-26T00:00:01.000Z",
				},
				prefetch: null,
			},
			history: [
				{
					requestId: "bootstrap-1-runtime-terrain/0102ffff",
					assetId: "terrain/0102ffff",
					priority: "bootstrap",
					status: "prepared",
					channel: "asset",
					summary: "Prepared terrain/0102ffff as a landblock terrain mesh with 81 vertices and 128 triangles.",
					timestamp: "2026-04-26T00:00:00.000Z",
				},
				{
					requestId: "streaming-2-runtime-terrain/0103ffff",
					assetId: "terrain/0103ffff",
					priority: "streaming",
					status: "prepared",
					channel: "asset",
					summary: "Prepared terrain/0103ffff as a landblock terrain mesh with 81 vertices and 128 triangles.",
					timestamp: "2026-04-26T00:00:01.000Z",
				},
			],
		});

		expect(report.headline).toMatch(/live host/);
		expect(report.assetSummary).toMatch(/bootstrap plus streaming/);
		expect(report.observedFlows).toContain("Bootstrap asset: terrain/0102ffff.");
		expect(report.observedFlows).toContain("Streaming asset: terrain/0103ffff.");
		expect(report.awkwardSeams[0]).toMatch(/Phase 9 now proves one outdoor terrain payload family/);
	});
});
