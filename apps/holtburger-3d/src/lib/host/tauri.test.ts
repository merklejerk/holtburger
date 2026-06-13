import { describe, expect, it } from "vitest";

import {
	lookupAsset,
	planAssetLookupEnvelopeRequests,
	planBinaryLookupBatches,
} from "./tauri";

describe("Tauri host commands", () => {
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
			createRequest("h", "landblock/0103ffff/env-cells"),
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
				"landblock/0103ffff/env-cells",
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
			createRequest("f", "landblock/0103ffff/env-cells"),
		]);

		expect(
			plan.binaryBatches.map((batch) =>
				batch.map((request) => request.assetId),
			),
		).toEqual([
			[
				"env-cell/01030100",
				"render-surface/06000001",
				"palette/04000001",
				"landblock/0103ffff/env-cells",
			],
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
