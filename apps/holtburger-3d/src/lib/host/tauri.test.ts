import { describe, expect, it } from "vitest";

import {
	lookupAsset,
	planAssetLookupEnvelopeRequests,
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
				assetId: "landblock/0102ffff/outdoor",
				priority: "bootstrap",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);
	});

	it("plans binary lookups as one host batch", () => {
		const batches = planBinaryLookupBatches([
			createRequest("a", "landblock/0102ffff/topology"),
			createRequest("b", "landblock/0102ffff/outdoor"),
			createRequest("c", "gfx-obj/01000001"),
			createRequest("d", "render-surface/06000001"),
			createRequest("e", "landblock/0103ffff/topology"),
			createRequest("f", "env-cell/01030100"),
			createRequest("g", "palette/04000001"),
		]);

		expect(
			batches.map((batch) => batch.map((request) => request.assetId)),
		).toEqual([
			[
				"landblock/0102ffff/topology",
				"landblock/0102ffff/outdoor",
				"gfx-obj/01000001",
				"render-surface/06000001",
				"landblock/0103ffff/topology",
				"env-cell/01030100",
				"palette/04000001",
			],
		]);
	});

	it("plans material recipes through JSON envelopes and palettes through binary lookup", () => {
		const plan = planAssetLookupEnvelopeRequests([
			createRequest("a", "env-cell/01030100"),
			createRequest("b", "material/0800006c"),
			createRequest("c", "render-surface/06000001"),
			createRequest("d", "surface-texture/05000001"),
			createRequest("e", "palette/04000001"),
		]);

		expect(
			plan.binaryBatches.map((batch) =>
				batch.map((request) => request.assetId),
			),
		).toEqual([
			["env-cell/01030100", "render-surface/06000001", "palette/04000001"],
		]);
		expect(plan.jsonRequests.map((request) => request.assetId)).toEqual([
			"material/0800006c",
			"surface-texture/05000001",
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
