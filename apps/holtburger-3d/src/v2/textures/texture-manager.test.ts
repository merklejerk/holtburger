import { describe, expect, it } from "vitest";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import type { StaticCoordinatorCommitDelta } from "../static/contracts";
import { TextureManager } from "./texture-manager";

describe("V2 texture manager", () => {
	it("turns bake-local texture uses into runtime-owned direct placements", async () => {
		const assetService = new FixtureAssetService();
		const textureManager = new TextureManager({ assetService });

		const update = await textureManager.applyStaticCommitDelta(
			createCommitDelta({
				format: "rgba8",
			}),
		);

		expect(assetService.requestedKeys).toEqual([
			{
				id: "06000010?colorSpace=srgb&mipPolicy=retail4&outputFormat=rgba8&usage=color",
				kind: "prepared-texture",
			},
		]);
		expect(update).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-a",
					textureRefId: "texture-ref:terrain-a:prepared-texture:06000010",
					textureUseId: "terrain-a:prepared-texture:06000010",
				},
			],
			placements: [
				{
					format: "rgba8",
					height: 1,
					kind: "direct-texture",
					rect: [0, 0, 1, 1],
					textureRefId: "texture-ref:terrain-a:prepared-texture:06000010",
					textureUseId: "terrain-a:prepared-texture:06000010",
					width: 1,
				},
			],
			removedTextureRefIds: [],
			revision: 1,
		});
		expect(Array.from(update?.placements[0]?.pixels ?? [])).toEqual([
			255, 128, 0, 255,
		]);
	});

	it("removes texture refs by draw-unit ownership without requiring rebaked geometry", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
		});

		await textureManager.applyStaticCommitDelta(createCommitDelta({ format: "rgba8" }));
		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 2,
			textureUses: [],
		});

		expect(update).toMatchObject({
			drawUnitBindings: [],
			placements: [],
			removedTextureRefIds: ["texture-ref:terrain-a:prepared-texture:06000010"],
			revision: 2,
		});
	});

	it("fails explicitly for unsupported direct texture formats", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
		});

		await expect(
			textureManager.applyStaticCommitDelta(createCommitDelta({ format: "dxt1" })),
		).rejects.toThrow("unsupported direct texture format dxt1");
	});
});

class FixtureAssetService implements AssetService {
	readonly requestedKeys: HostAssetKey[] = [];

	async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requestedKeys.push(key);

		const format = key.id.includes("dxt1") ? "dxt1" : "rgba8";
		return {
			key,
			payload: createPreparedTexturePayload(format),
			preparedAt: "test",
			revision: 1,
			sourceAssetId: `prepared-texture/${key.id}`,
		};
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		return {
			key,
			release() {},
		};
	}

	pruneExpiredWarmAssets(): void {}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			failures: [],
			pending: [],
		};
	}
}

function createCommitDelta(options: {
	readonly format: "rgba8" | "dxt1";
}): StaticCoordinatorCommitDelta {
	return {
		addedDrawUnits: [],
		removedDrawUnitIds: [],
		revision: 1,
		textureUses: [
			{
				domain: "outdoor-terrain",
				ownerDrawUnitIds: ["terrain-a"],
				source: {
					colorSpace: "srgb",
					kind: "prepared-texture-use",
					mipPolicy: "retail4",
					outputFormat: options.format,
					renderSurfaceId: 0x06000010,
					usage: "color",
				},
				textureUseId: "terrain-a:prepared-texture:06000010",
			},
		],
	};
}

function createPreparedTexturePayload(format: "rgba8" | "dxt1") {
	return {
		colorSpace: "srgb",
		kind: "prepared-texture",
		levels: [
			{
				bytes: new Uint8Array([255, 128, 0, 255]),
				format,
				height: 1,
				level: 0,
				width: 1,
			},
		],
		mipPolicy: "retail4",
		outputFormat: format,
		renderSurfaceId: 0x06000010,
		usage: "color",
	};
}
