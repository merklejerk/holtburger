import { afterEach, describe, expect, it, vi } from "vitest";

import {
	listenForRuntimeLifecycle,
	lookupAsset,
	readHostBoundarySnapshot,
	resolveRayPick,
	submitCameraHint,
} from "./tauri";
import type { RuntimeNotificationEnvelopeDto } from "./contracts";

afterEach(() => {
	vi.useRealTimers();
});

describe("readHostBoundarySnapshot", () => {
	it("returns the browser-preview fallback shape outside the Tauri runtime", async () => {
		const snapshot = await readHostBoundarySnapshot();

		expect(snapshot.source).toBe("browser-preview");
		expect(snapshot.lifecycleState.activeModeHint).toBe("browser");
		expect(snapshot.runtimeBatch.tick).toBeGreaterThan(0);
		expect(snapshot.runtimeBatch.entities).toHaveLength(0);
		expect(snapshot.runtimeBatch.residency.focusLocationLabel).toMatch(/Z$/);
		expect(snapshot.viewModelFeed.interactionMode).toBe("inspect");
		expect(snapshot.overview.assetChannel).toBe("asset");
		expect(snapshot.overview.runtimeNotificationEvent).toBe(
			"runtime:notification",
		);
	});

	it("accepts fallback camera hints and leaves debug picks unresolved outside Tauri", async () => {
		const cameraAck = await submitCameraHint({
			mode: "browser",
			source: "world-display",
			position: { x: 12, y: -4.5, z: 1 },
			forward: { x: 0, y: 1, z: 0 },
			viewportNormalizedX: 0.65,
			viewportNormalizedY: 0.5,
			destinationLabel: "100.40S, 101.55W, 1.0Z",
		});
		const response = await resolveRayPick({
			requestId: "fallback-pick",
			origin: { x: 12, y: -4.5, z: 1 },
			direction: { x: 0, y: 1, z: 0 },
			screenXNormalized: 0.65,
			screenYNormalized: 0.5,
			destinationLabel: "100.40S, 101.55W, 1.0Z",
		});

		expect(cameraAck.accepted).toBe(true);
		expect(response.resolved).toBe(false);
		expect(response.hit).toBeNull();
	});

	it("keeps asset lookup on a dedicated fallback path outside Tauri", async () => {
		const response = await lookupAsset({
			requestId: "bootstrap-asset",
			assetId: "terrain/0102ffff",
			priority: "bootstrap",
		});

		expect(response.assetId).toBe("terrain/0102ffff");
		expect(response.payloadKind).toBe("json");
		expect(response.payload).toMatchObject({
			kind: "terrain-landblock",
			residencyKind: "outdoor-landblock",
			landblockId: 0x0102ffff,
		});
	});

	it("emits fallback runtime notifications so browser preview can exercise streaming flows", async () => {
		vi.useFakeTimers();
		const notifications: RuntimeNotificationEnvelopeDto[] = [];
		const dispose = await listenForRuntimeLifecycle((notification) => {
			notifications.push(notification);
		});

		await vi.advanceTimersByTimeAsync(2_100);
		dispose();

		expect(notifications).toHaveLength(2);
		expect(notifications[0].runtimeBatch?.tick).toBe(2);
		expect(notifications[0].runtimeBatch?.entities).toHaveLength(0);
		expect(notifications[0].viewModelFeed?.selectedEntityId).toBeNull();
		expect(notifications[1].viewModelFeed?.selectedEntityId).toBeNull();
	});
});
