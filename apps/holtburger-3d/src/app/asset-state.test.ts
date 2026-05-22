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
					assetId: "landblock-pack/0102ffff",
					priority: "bootstrap",
				},
				{
					requestId: "streaming-terrain-b",
					assetId: "landblock-pack/0103ffff",
					priority: "streaming",
				},
			],
			"2026-04-26T00:00:00.000Z",
		);

		expect(state.status).toBe("pending");
		expect(state.activeRequest?.assetId).toBe("landblock-pack/0103ffff");
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
					"landblock-pack/0102ffff",
				),
				createPreparedTerrainAsset(
					"bootstrap-terrain-b",
					"landblock-pack/0103ffff",
				),
			],
			1_777,
		);

		expect(state.status).toBe("ready");
		expect(state.activeRequest?.assetId).toBe("landblock-pack/0103ffff");
		expect(state.preparedByPriority.bootstrap?.request.assetId).toBe(
			"landblock-pack/0103ffff",
		);
		expect(state.preparedByAssetId["landblock-pack/0102ffff"]).toBeDefined();
		expect(state.preparedByAssetId["landblock-pack/0103ffff"]).toBeDefined();
		expect(state.cacheMetadataByAssetId).toEqual({
			"landblock-pack/0102ffff": {
				lastPreparedAtMs: 1_777,
				lastRetainedAtMs: 1_777,
			},
			"landblock-pack/0103ffff": {
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
					"landblock-pack/0102ffff",
				),
				createPreparedTerrainAsset(
					"bootstrap-terrain-b",
					"landblock-pack/0103ffff",
				),
			],
			1_000,
		);

		const prunedState = applyAssetCachePrune(state, {
			retainedAssetIds: ["landblock-pack/0102ffff"],
			evictedAssetIds: ["landblock-pack/0103ffff"],
			cacheMetadataByAssetId: {
				"landblock-pack/0102ffff": {
					lastPreparedAtMs: 1_000,
					lastRetainedAtMs: 2_000,
				},
			},
			diagnostics: {
				prepared: {
					total: 2,
					byKind: {
						"landblock-pack": 2,
					},
				},
				retained: {
					total: 1,
					byKind: {
						"landblock-pack": 1,
					},
				},
				evicted: {
					total: 1,
					byKind: {
						"landblock-pack": 1,
					},
				},
			},
		});

		expect(Object.keys(prunedState.preparedByAssetId)).toEqual([
			"landblock-pack/0102ffff",
		]);
		expect(prunedState.cacheMetadataByAssetId).toEqual({
			"landblock-pack/0102ffff": {
				lastPreparedAtMs: 1_000,
				lastRetainedAtMs: 2_000,
			},
		});
		expect(prunedState.preparedByPriority.bootstrap).toBeNull();
		expect(prunedState.preparedAsset).toBeNull();
		expect(prunedState.lastResponse).toBeNull();
		expect(prunedState.cacheDiagnostics?.evicted.total).toBe(1);
		expect(prunedState.history.map((entry) => entry.assetId)).toEqual([
			"landblock-pack/0102ffff",
			"landblock-pack/0103ffff",
		]);
	});
});
