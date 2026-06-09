import { describe, expect, it } from "vitest";

import { createPreparedTerrainAsset } from "../../app/test-fixtures";
import { PreparedAssetStore, type PreparedAssetChangeEvent } from "./prepared-asset-store";

describe("PreparedAssetStore", () => {
	it("owns prepared assets behind a stable resolver", () => {
		const store = new PreparedAssetStore();
		const resolver = store.resolver;
		const events: PreparedAssetChangeEvent[] = [];
		const unsubscribe = resolver.subscribe((event) => events.push(event));
		const terrain = createPreparedTerrainAsset(
			"terrain-a",
			"landblock/0102ffff/outdoor",
		);

		store.applyPreparedAssets([terrain], 1_000);

		expect(store.resolver).toBe(resolver);
		expect(resolver.get("landblock/0102ffff/outdoor")).toBe(terrain);
		expect(resolver.getCacheMetadata("landblock/0102ffff/outdoor")).toEqual({
			lastPreparedAtMs: 1_000,
			lastRetainedAtMs: 1_000,
		});
		expect(resolver.getPreparedRevision()).toBe(1);
		expect(resolver.getCacheMetadataRevision()).toBe(1);
		expect(events).toEqual([
			{
				type: "prepared-assets-updated",
				assets: [
					{
						assetId: "landblock/0102ffff/outdoor",
						kind: "landblock-outdoor",
					},
				],
				preparedRevision: 1,
				cacheMetadataRevision: 1,
			},
		]);

		unsubscribe();
		store.applyPreparedAssets(
			[
				createPreparedTerrainAsset(
					"terrain-b",
					"landblock/0103ffff/outdoor",
				),
			],
			2_000,
		);

		expect(events).toHaveLength(1);
	});

	it("applies prune batches without requiring a full retained cache plan", () => {
		const store = new PreparedAssetStore();
		const events: PreparedAssetChangeEvent[] = [];
		store.resolver.subscribe((event) => events.push(event));
		store.applyPreparedAssets(
			[
				createPreparedTerrainAsset(
					"terrain-a",
					"landblock/0102ffff/outdoor",
				),
				createPreparedTerrainAsset(
					"terrain-b",
					"landblock/0103ffff/outdoor",
				),
				createPreparedTerrainAsset(
					"terrain-c",
					"landblock/0104ffff/outdoor",
				),
			],
			1_000,
		);

		store.applyPruneBatch({
			retainedAssetIds: ["landblock/0102ffff/outdoor"],
			evictedAssetIds: [
				"landblock/0103ffff/outdoor",
				"landblock/0104ffff/outdoor",
			],
			retainedMetadataByAssetId: {
				"landblock/0102ffff/outdoor": {
					lastPreparedAtMs: 1_000,
					lastRetainedAtMs: 2_000,
				},
			},
			nextCursorAssetId: null,
			evaluatedAssetCount: 3,
			nextWarmPruneAtMs: null,
		});

		expect(store.resolver.has("landblock/0102ffff/outdoor")).toBe(true);
		expect(store.resolver.has("landblock/0103ffff/outdoor")).toBe(false);
		expect(store.resolver.has("landblock/0104ffff/outdoor")).toBe(false);
		expect(
			store.resolver.getCacheMetadata("landblock/0102ffff/outdoor"),
		).toEqual({
			lastPreparedAtMs: 1_000,
			lastRetainedAtMs: 2_000,
		});
		expect(events.at(-1)).toEqual({
			type: "prepared-assets-evicted",
			assets: [
				{
					assetId: "landblock/0103ffff/outdoor",
					kind: "landblock-outdoor",
				},
				{
					assetId: "landblock/0104ffff/outdoor",
					kind: "landblock-outdoor",
				},
			],
			preparedRevision: 2,
			cacheMetadataRevision: 2,
		});
	});

	it("scans prepared assets in bounded resolver-native pages", () => {
		const store = new PreparedAssetStore();
		store.applyPreparedAssets(
			[
				createPreparedTerrainAsset(
					"terrain-a",
					"landblock/0102ffff/outdoor",
				),
				createPreparedTerrainAsset(
					"terrain-b",
					"landblock/0103ffff/outdoor",
				),
				createPreparedTerrainAsset(
					"terrain-c",
					"landblock/0104ffff/outdoor",
				),
			],
			1_000,
		);

		const firstPage = store.resolver.scanPreparedAssets({
			cursorAssetId: null,
			limit: 2,
		});
		expect(firstPage.entries.map((entry) => entry.assetId)).toEqual([
			"landblock/0102ffff/outdoor",
			"landblock/0103ffff/outdoor",
		]);
		expect(firstPage.nextCursorAssetId).toBe("landblock/0104ffff/outdoor");
		expect(firstPage.preparedCount).toBe(3);
		expect(firstPage.entries[0]?.cacheMetadata).toEqual({
			lastPreparedAtMs: 1_000,
			lastRetainedAtMs: 1_000,
		});

		const secondPage = store.resolver.scanPreparedAssets({
			cursorAssetId: firstPage.nextCursorAssetId,
			limit: 2,
		});
		expect(secondPage.entries.map((entry) => entry.assetId)).toEqual([
			"landblock/0104ffff/outdoor",
		]);
		expect(secondPage.nextCursorAssetId).toBeNull();
	});

	it("creates explicit legacy snapshots for record-shaped migration callers", () => {
		const store = new PreparedAssetStore();
		const terrain = createPreparedTerrainAsset(
			"terrain-a",
			"landblock/0102ffff/outdoor",
		);
		store.applyPreparedAssets([terrain], 1_000);

		const snapshot = store.createLegacySnapshot();
		expect(snapshot.preparedByAssetId).toEqual({
			"landblock/0102ffff/outdoor": terrain,
		});
		expect(snapshot.cacheMetadataByAssetId).toEqual({
			"landblock/0102ffff/outdoor": {
				lastPreparedAtMs: 1_000,
				lastRetainedAtMs: 1_000,
			},
		});

		store.applyPreparedAssets(
			[
				createPreparedTerrainAsset(
					"terrain-b",
					"landblock/0103ffff/outdoor",
				),
			],
			2_000,
		);

		expect(snapshot.preparedByAssetId).not.toHaveProperty(
			"landblock/0103ffff/outdoor",
		);
	});
});
