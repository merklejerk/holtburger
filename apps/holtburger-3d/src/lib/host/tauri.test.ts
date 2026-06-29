import { describe, expect, it } from "vitest";

import { lookupAsset, planBinaryLookupBatches } from "./tauri";

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
			createRequest("i", "landblock/0103ffff/lod/4"),
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
				"landblock/0103ffff/lod/4",
			],
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
