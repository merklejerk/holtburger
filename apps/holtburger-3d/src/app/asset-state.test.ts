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
					assetId: "terrain/0102ffff",
					priority: "bootstrap",
				},
				{
					requestId: "streaming-terrain-b",
					assetId: "terrain/0103ffff",
					priority: "streaming",
				},
			],
			"2026-04-26T00:00:00.000Z",
		);

		expect(state.status).toBe("pending");
		expect(state.activeRequest?.assetId).toBe("terrain/0103ffff");
		expect(state.history.map((entry) => entry.status)).toEqual([
			"requested",
			"requested",
		]);
	});

	it("indexes prepared assets by priority and asset id", () => {
		const state = applyPreparedAssets(createAssetState(), [
			createPreparedTerrainAsset("bootstrap-terrain-a", "terrain/0102ffff"),
			createPreparedTerrainAsset("bootstrap-terrain-b", "terrain/0103ffff"),
		]);

		expect(state.status).toBe("ready");
		expect(state.activeRequest?.assetId).toBe("terrain/0103ffff");
		expect(state.preparedByPriority.bootstrap?.request.assetId).toBe(
			"terrain/0103ffff",
		);
		expect(state.preparedByAssetId["terrain/0102ffff"]).toBeDefined();
		expect(state.preparedByAssetId["terrain/0103ffff"]).toBeDefined();
	});
});
