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
				assetIds: ["landblock/0102ffff/outdoor"],
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

	it("applies prune plans and emits bounded eviction events", () => {
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
			],
			1_000,
		);

		store.applyPrunePlan({
			retainedAssetIds: ["landblock/0102ffff/outdoor"],
			evictedAssetIds: ["landblock/0103ffff/outdoor"],
			cacheMetadataByAssetId: {
				"landblock/0102ffff/outdoor": {
					lastPreparedAtMs: 1_000,
					lastRetainedAtMs: 2_000,
				},
			},
			diagnostics: {
				prepared: { total: 2, byKind: { "landblock-outdoor": 2 } },
				hardRetained: { total: 1, byKind: { "landblock-outdoor": 1 } },
				warmRetained: { total: 0, byKind: {} },
				retained: { total: 1, byKind: { "landblock-outdoor": 1 } },
				evicted: { total: 1, byKind: { "landblock-outdoor": 1 } },
			},
			nextWarmPruneAtMs: null,
		});

		expect(store.resolver.has("landblock/0102ffff/outdoor")).toBe(true);
		expect(store.resolver.has("landblock/0103ffff/outdoor")).toBe(false);
		expect(store.resolver.getPreparedRevision()).toBe(2);
		expect(store.resolver.getCacheMetadataRevision()).toBe(2);
		expect(events.at(-1)).toEqual({
			type: "prepared-assets-evicted",
			assetIds: ["landblock/0103ffff/outdoor"],
			preparedRevision: 2,
			cacheMetadataRevision: 2,
		});
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
