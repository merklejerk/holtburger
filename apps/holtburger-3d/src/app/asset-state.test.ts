import { describe, expect, it } from "vitest";

import {
	applyAssetCachePrune,
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

	it("applies cache prune diagnostics without owning retained payload references", () => {
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

		const prunedState = applyAssetCachePrune(state, {
			retainedAssetIds: ["landblock/0102ffff/outdoor"],
			evictedAssetIds: ["landblock/0103ffff/outdoor"],
			cacheMetadataByAssetId: {
				"landblock/0102ffff/outdoor": {
					lastPreparedAtMs: 1_000,
					lastRetainedAtMs: 2_000,
				},
			},
			diagnostics: {
				prepared: {
					total: 2,
					byKind: {
						"landblock-outdoor": 2,
					},
				},
				retained: {
					total: 1,
					byKind: {
						"landblock-outdoor": 1,
					},
				},
				evicted: {
					total: 1,
					byKind: {
						"landblock-outdoor": 1,
					},
				},
			},
		});

		expect(prunedState.preparedByAssetId).toEqual({});
		expect(prunedState.cacheMetadataByAssetId).toEqual({});
		expect(prunedState.preparedByPriority.bootstrap).toBeNull();
		expect(prunedState.preparedAsset).toBeNull();
		expect(prunedState.lastResponse?.assetId).toBe(
			"landblock/0103ffff/outdoor",
		);
		expect(prunedState.cacheDiagnostics?.evicted.total).toBe(1);
		expect(prunedState.history.map((entry) => entry.assetId)).toEqual([
			"landblock/0102ffff/outdoor",
			"landblock/0103ffff/outdoor",
		]);
	});
});
