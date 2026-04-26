import { describe, expect, it } from "vitest";

import {
	readHostBoundarySnapshot,
	resolveRayPick,
	submitCameraHint,
} from "./tauri";

describe("readHostBoundarySnapshot", () => {
	it("returns the browser-preview fallback shape outside the Tauri runtime", async () => {
		const snapshot = await readHostBoundarySnapshot();

		expect(snapshot.source).toBe("browser-preview");
		expect(snapshot.lifecycleState.activeModeHint).toBe("browser");
		expect(snapshot.runtimeBatch.tick).toBeGreaterThan(0);
		expect(snapshot.runtimeBatch.residency.focusLocationLabel).toMatch(/Z$/);
		expect(snapshot.viewModelFeed.interactionMode).toBe("inspect");
		expect(snapshot.overview.runtimeNotificationEvent).toBe(
			"runtime:notification",
		);
	});

	it("accepts fallback camera hints and resolves fallback debug picks outside Tauri", async () => {
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
		expect(response.resolved).toBe(true);
		expect(response.hit?.label).toBe("Survey Drudge");
	});
});
