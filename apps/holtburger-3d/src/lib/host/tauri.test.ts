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
	it("fails fast outside the Tauri runtime when reading the host snapshot", async () => {
		await expect(readHostBoundarySnapshot()).rejects.toThrow(/requires the Tauri runtime/i);
	});

	it("fails fast outside the Tauri runtime when submitting camera hints or picks", async () => {
		await expect(
			submitCameraHint({
				mode: "client",
				source: "world-display",
				position: { x: 12, y: -4.5, z: 1 },
				forward: { x: 0, y: 1, z: 0 },
				viewportNormalizedX: 0.65,
				viewportNormalizedY: 0.5,
				destinationLabel: "100.40S, 101.55W, 1.0Z",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);

		await expect(
			resolveRayPick({
				requestId: "fallback-pick",
				origin: { x: 12, y: -4.5, z: 1 },
				direction: { x: 0, y: 1, z: 0 },
				screenXNormalized: 0.65,
				screenYNormalized: 0.5,
				destinationLabel: "100.40S, 101.55W, 1.0Z",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);
	});

	it("fails asset lookup outside the Tauri runtime", async () => {
		await expect(
			lookupAsset({
				requestId: "bootstrap-asset",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);
	});

	it("fails fast outside the Tauri runtime when registering for runtime notifications", async () => {
		vi.useFakeTimers();
		const notifications: RuntimeNotificationEnvelopeDto[] = [];

		await expect(
			listenForRuntimeLifecycle((notification) => {
				notifications.push(notification);
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);

		expect(notifications).toHaveLength(0);
	});
});
