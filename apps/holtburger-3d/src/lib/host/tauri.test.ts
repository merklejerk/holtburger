import { describe, expect, it } from "vitest";

import { lookupAsset, submitCameraHint } from "./tauri";

describe("Tauri host commands", () => {
	it("fails fast outside the Tauri runtime when submitting camera hints", async () => {
		await expect(
			submitCameraHint({
				source: "world-display",
				position: { x: 12, y: -4.5, z: 1 },
				forward: { x: 0, y: 1, z: 0 },
				viewportNormalizedX: 0.65,
				viewportNormalizedY: 0.5,
				destinationLabel: "100.40S, 101.55W, 1.0Z",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);
	});

	it("fails asset lookup outside the Tauri runtime", async () => {
		await expect(
			lookupAsset({
				requestId: "bootstrap-asset",
				assetId: "landblock-pack/0102ffff",
				priority: "bootstrap",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);
	});
});
