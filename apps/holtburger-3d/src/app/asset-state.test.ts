import { describe, expect, it } from "vitest";

import {
	applyPreparedAssets,
	createAssetState,
	markAssetsPending,
} from "./asset-state";
import { createPreparedTerrainAsset } from "./test-fixtures";

describe("asset state reducer", () => {
	it("marks pending requests and records bounded activity", () => {
		const state = markAssetsPending(
			createAssetState(),
			[
				{
					requestId: "bootstrap-terrain-a",
					assetId: "landblock/0102ffff/outdoor",
					priority: "bootstrap",
				},
				{
					requestId: "streaming-terrain-b",
					assetId: "landblock/0103ffff/outdoor",
					priority: "streaming",
				},
			],
			"2026-04-26T00:00:00.000Z",
		);

		expect(state.status).toBe("pending");
		expect(state.activeRequest?.assetId).toBe("landblock/0103ffff/outdoor");
		expect(state.history.map((entry) => entry.status)).toEqual([
			"requested",
			"requested",
		]);
	});

	it("records prepared status without owning prepared payload indexes", () => {
		const state = applyPreparedAssets(
			createAssetState(),
			[
				createPreparedTerrainAsset(
					"bootstrap-terrain-a",
					"landblock/0102ffff/outdoor",
				),
				createPreparedTerrainAsset(
					"bootstrap-terrain-b",
					"landblock/0103ffff/outdoor",
				),
			],
		);

		expect(state.status).toBe("ready");
		expect(state.activeRequest?.assetId).toBe("landblock/0103ffff/outdoor");
		expect(state.preparedAsset).toBeNull();
		expect(state.preparedByPriority).toEqual({
			bootstrap: null,
			streaming: null,
			prefetch: null,
		});
		expect(state.preparedByAssetId).toEqual({});
		expect(state.cacheMetadataByAssetId).toEqual({});
		expect(state.history.map((entry) => entry.status)).toEqual([
			"prepared",
			"prepared",
		]);
	});

});
