import { describe, expect, it } from "vitest";

import {
	createPreparedTextureHostKey,
	type PreparedAsset,
} from "../../../../assets/preparation/prepared-texture-source";
import type { PreparedAssetReader } from "../../../../assets/contracts";
import type { PreparedRenderSurfaceTextureUseIdentity } from "../../../../static/contracts";
import {
	createTexturePlacementItemId,
	type ObjectVisualTexturePlacementIntent,
} from "../../../../textures/placement";
import type {
	TextureBindingId,
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../claims/texture-claim-registry";
import { buildObjectVisualTexturePlacementPlan } from "./object-visual-texture-placement-plan";

describe("buildObjectVisualTexturePlacementPlan", () => {
	it("packs object visual material textures into replacement texture commits", async () => {
		const assetReader = new FixturePreparedAssetReader();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const intent = createIntent({ itemNumber: 1 });

		const plan = await buildObjectVisualTexturePlacementPlan({
			assetReader,
			filteringMode: "nearest",
			intents: [intent],
			ownerId: ownerId("static-layer:outdoor-generated-scenery:0xda55ffff"),
			textureClaims,
		});

		expect(assetReader.requests).toEqual([
			createPreparedTextureHostKey(createTextureUse()),
		]);
		expect(textureClaims.createSnapshot()).toMatchObject({
			bucketCount: 1,
			claimCount: 1,
			entryCount: 1,
			pageBuildsInFlight: 0,
			pageCount: 1,
		});
		expect(
			plan.placementSnapshot.itemIdsByBindingId.get(intent.bindingId),
		).toBe(intent.itemId);
		expect(
			plan.placementSnapshot.placementsByItemId.get(intent.itemId),
		).toMatchObject({
			itemId: intent.itemId,
			purpose: "object-base-color",
			rect: [4, 4, 1, 1],
			textureKey: intent.textureKey,
		});
		expect(plan.textureCommits).toEqual([
			expect.objectContaining({
				bindingUpdates: [
					expect.objectContaining({
						bindingId: intent.bindingId,
						readiness: expect.objectContaining({
							kind: "resident",
							rect: [4, 4, 1, 1],
						}),
					}),
				],
				kind: "texture-commit",
				pageUpdates: [
					expect.objectContaining({
						format: "rgba8",
						height: expect.any(Number) as number,
						sampleClass: "rgba-color",
						uploadBindingId: intent.bindingId,
						width: expect.any(Number) as number,
					}),
				],
			}),
		]);
	});

	it("does not require source intents for other owners already retained in the bucket", async () => {
		const assetReader = new FixturePreparedAssetReader();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		await buildObjectVisualTexturePlacementPlan({
			assetReader,
			filteringMode: "nearest",
			intents: [createIntent({ itemNumber: 1 })],
			ownerId: ownerId("static-layer:outdoor-generated-scenery:0xda55ffff"),
			textureClaims,
		});

		const secondIntent = createIntent({
			bindingId: bindingId("binding:object-base:second"),
			itemNumber: 2,
			textureKey: textureKey("texture:object-base:second"),
		});
		const secondPlan = await buildObjectVisualTexturePlacementPlan({
			assetReader,
			filteringMode: "nearest",
			intents: [secondIntent],
			ownerId: ownerId("static-layer:outdoor-generated-scenery:0xda56ffff"),
			textureClaims,
		});

		expect(
			secondPlan.placementSnapshot.itemIdsByBindingId.has(
				secondIntent.bindingId,
			),
		).toBe(true);
		expect(secondPlan.textureCommits).toHaveLength(1);
		expect(secondPlan.textureCommits[0]?.bindingUpdates).toEqual([
			expect.objectContaining({ bindingId: secondIntent.bindingId }),
		]);
	});
});

class FixturePreparedAssetReader implements PreparedAssetReader {
	readonly requests: ReturnType<typeof createPreparedTextureHostKey>[] = [];

	async requestPreparedAsset(
		key: ReturnType<typeof createPreparedTextureHostKey>,
	): Promise<PreparedAsset> {
		this.requests.push(key);
		return createPreparedAsset();
	}
}

function createIntent(input: {
	readonly bindingId?: TextureBindingId;
	readonly itemNumber: number;
	readonly textureKey?: TextureKey;
}): ObjectVisualTexturePlacementIntent {
	const source = createTextureUse();
	return {
		affinityKey: "fixture-affinity",
		bindingId: input.bindingId ?? bindingId("binding:object-base"),
		domain: "outdoor-generated-scenery",
		itemId: createTexturePlacementItemId(input.itemNumber),
		ownerIds: [],
		pageClass: pageClass("page-class:object-base"),
		placementBucketKey:
			"legacy-bucket:unused" as ObjectVisualTexturePlacementIntent["placementBucketKey"],
		purpose: "object-base-color",
		source: {
			dataUse: source,
			kind: "material-texture-data-use",
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "repeat",
			},
		},
		textureKey: input.textureKey ?? textureKey("texture:object-base"),
	};
}

function createTextureUse(): PreparedRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
	};
}

function createPreparedAsset(): PreparedAsset {
	return {
		key: createPreparedTextureHostKey(createTextureUse()),
		payload: createPreparedTexturePayload(),
		preparedAt: "test",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function createPreparedTexturePayload() {
	const bytes = new Uint8Array([255, 128, 0, 255]);
	return {
		colorSpace: "linear",
		dependencies: {
			renderSurfaceAssetIds: ["render-surface/06000010"],
		},
		diagnostics: {
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			generatedByteLength: bytes.byteLength,
			generatedLevelCount: 1,
			totalMs: 0,
		},
		kind: "prepared-texture",
		levels: [
			{
				byteLength: bytes.byteLength,
				bytes,
				format: "A8R8G8B8",
				formatRaw: 0,
				height: 1,
				level: 0,
				width: 1,
			},
		],
		mipPolicy: "none",
		outputFormat: "rgba8",
		provenance: {
			assetId: "prepared-texture/06000010",
			collectedAt: "test",
			source: "host",
		},
		renderSurfaceId: 0x06000010,
		residencyKind: "unknown",
		sourceAssetKind: "prepared-texture",
		sourceByteLength: bytes.byteLength,
		sourceFormat: "A8R8G8B8",
		sourceFormatRaw: 0,
		sourceHash: "hash",
		sourceHeight: 1,
		sourceWidth: 1,
		usage: "color",
	};
}

function bindingId(value: string): TextureBindingId {
	return value as TextureBindingId;
}

function ownerId(value: string): MaterializationOwnerId {
	return value as MaterializationOwnerId;
}

function pageClass(value: string): TexturePageClass {
	return value as TexturePageClass;
}

function textureKey(value: string): TextureKey {
	return value as TextureKey;
}
