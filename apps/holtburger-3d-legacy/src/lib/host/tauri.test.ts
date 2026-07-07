import { describe, expect, it } from "vitest";

import {
	lookupAsset,
	planBinaryLookupBatches,
	usesBinaryAssetLookup,
} from "./tauri";

describe("Tauri host commands", () => {
	it("fails asset lookup outside the Tauri runtime", async () => {
		await expect(
			lookupAsset({
				requestId: "bootstrap-asset",
				assetId: "landblock/0102ffff/lod/2",
				priority: "bootstrap",
			}),
		).rejects.toThrow(/requires the Tauri runtime/i);
	});

	it("plans binary lookups as one host batch", () => {
		const batches = planBinaryLookupBatches([
			createRequest("a", "landblock/0102ffff/lod/2"),
			createRequest("c", "gfx-obj/01000001"),
			createRequest("d", "render-surface/06000001"),
			createRequest("f", "env-cell/01030100"),
			createRequest("g", "palette/04000001"),
			createRequest("i", "landblock/0103ffff/lod/4"),
		]);

		expect(
			batches.map((batch) => batch.map((request) => request.assetId)),
		).toEqual([
			[
				"landblock/0102ffff/lod/2",
				"gfx-obj/01000001",
				"render-surface/06000001",
				"env-cell/01030100",
				"palette/04000001",
				"landblock/0103ffff/lod/4",
			],
		]);
	});

	it("routes prepared palette textures through binary lookup", () => {
		expect(
			usesBinaryAssetLookup("prepared-palette-texture/04000001?domain=index8"),
		).toBe(true);
	});
});

function createRequest(requestId: string, assetId: string) {
	return {
		requestId,
		assetId,
		priority: "streaming" as const,
	};
}
