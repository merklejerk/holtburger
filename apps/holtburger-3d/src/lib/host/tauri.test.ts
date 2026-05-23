import { describe, expect, it } from "vitest";

import {
	lookupAsset,
	planBinaryLookupBatches,
	submitCameraHint,
} from "./tauri";

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

	it("isolates large binary lookups from small batched assets", () => {
		const batches = planBinaryLookupBatches([
			createRequest("a", "landblock-summary/0102ffff"),
			createRequest("b", "landblock-pack/0102ffff"),
			createRequest("c", "gfx-obj/01000001"),
			createRequest("d", "render-surface/06000001"),
			createRequest("e", "landblock-summary/0103ffff"),
			createRequest("f", "landblock-pack/0103ffff"),
		]);

		expect(
			batches.map((batch) => batch.map((request) => request.assetId)),
		).toEqual([
			["landblock-summary/0102ffff"],
			["landblock-pack/0102ffff"],
			["gfx-obj/01000001"],
			["render-surface/06000001"],
			["landblock-summary/0103ffff"],
			["landblock-pack/0103ffff"],
		]);
	});
});

function createRequest(requestId: string, assetId: string) {
	return {
		requestId,
		assetId,
		priority: "streaming" as const,
	};
}
