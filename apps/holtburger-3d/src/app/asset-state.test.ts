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

	it("indexes prepared assets by priority and asset id", () => {
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
			1_777,
		);

		expect(state.status).toBe("ready");
		expect(state.activeRequest?.assetId).toBe("landblock/0103ffff/outdoor");
		expect(state.preparedByPriority.bootstrap?.request.assetId).toBe(
			"landblock/0103ffff/outdoor",
		);
		expect(state.preparedByAssetId["landblock/0102ffff/outdoor"]).toBeDefined();
		expect(state.preparedByAssetId["landblock/0103ffff/outdoor"]).toBeDefined();
		expect(state.cacheMetadataByAssetId).toEqual({
			"landblock/0102ffff/outdoor": {
				lastPreparedAtMs: 1_777,
				lastRetainedAtMs: 1_777,
			},
			"landblock/0103ffff/outdoor": {
				lastPreparedAtMs: 1_777,
				lastRetainedAtMs: 1_777,
			},
		});
	});

	it("prunes evicted prepared payload references without making history a retention root", () => {
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
			1_000,
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

		expect(Object.keys(prunedState.preparedByAssetId)).toEqual([
			"landblock/0102ffff/outdoor",
		]);
		expect(prunedState.cacheMetadataByAssetId).toEqual({
			"landblock/0102ffff/outdoor": {
				lastPreparedAtMs: 1_000,
				lastRetainedAtMs: 2_000,
			},
		});
		expect(prunedState.preparedByPriority.bootstrap).toBeNull();
		expect(prunedState.preparedAsset).toBeNull();
		expect(prunedState.lastResponse).toBeNull();
		expect(prunedState.cacheDiagnostics?.evicted.total).toBe(1);
		expect(prunedState.history.map((entry) => entry.assetId)).toEqual([
			"landblock/0102ffff/outdoor",
			"landblock/0103ffff/outdoor",
		]);
	});
});
