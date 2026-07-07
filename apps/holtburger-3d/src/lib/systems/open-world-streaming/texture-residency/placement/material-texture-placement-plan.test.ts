import { describe, expect, it } from "vitest";

import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../../../assets/contracts";
import { createPreparedTextureHostKey } from "../../../../assets/preparation/prepared-texture-source";
import type { PreparedRenderSurfaceTextureUseIdentity } from "../../../../static/contracts";
import type {
	TexturePlacementIntent,
	TexturePlacementPolicy,
} from "../../../../textures/placement";
import type {
	TextureBindingId,
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../claims/texture-claim-registry";
import { DirectOpenWorldTexturePageBuilder } from "../page-build/direct-page-builder";
import type {
	OpenWorldMaterialTextureAtlasBuildInput,
	OpenWorldMaterialTextureAtlasPlacementOutput,
	OpenWorldMaterialTextureAtlasBuilder,
} from "./object-visual-atlas-builder";
import {
	buildMaterialTexturePlacementPlan,
	reserveMaterialTexturePlacements,
} from "./material-texture-placement-plan";

describe("buildMaterialTexturePlacementPlan", () => {
	it("uses packed page output for terrain-shaped string placement ids", async () => {
		const atlasBuilder = new FixtureAtlasBuilder();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const intent = createTerrainIntent();

		const plan = await buildMaterialTexturePlacementPlan<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [intent],
			jobPrefix: "fixture-terrain",
			ownerId: ownerId("static-layer:terrain:0xda55ffff"),
			pageBuilder: new DirectOpenWorldTexturePageBuilder({
				assetReader: new FixturePreparedAssetReader(),
			}),
			textureClaims,
		});

		expect(atlasBuilder.inputs).toHaveLength(1);
		expect(atlasBuilder.inputs[0]).toMatchObject({
			domain: "outdoor-terrain",
			jobId: expect.stringContaining("fixture-terrain"),
		});
		expect(plan.bindingPlacements).toEqual([
			expect.objectContaining({
				bindingId: intent.bindingId,
				placement: expect.objectContaining({
					itemId: "terrain:item:1",
					rect: [96, 96, 1, 1],
				}),
			}),
		]);
		expect(plan.textureCommits).toEqual([
			expect.objectContaining({
				bindingUpdates: [
					expect.objectContaining({
						bindingId: intent.bindingId,
						readiness: expect.objectContaining({
							kind: "resident",
							rect: [96, 96, 1, 1],
							textureHeight: 256,
							textureWidth: 256,
						}),
					}),
				],
				pageUpdates: [
					expect.objectContaining({
						height: 256,
						pixels: expect.any(Uint8Array),
						sampleClass: "rgba-color",
						width: 256,
					}),
				],
			}),
		]);
	});

	it("creates bake-facing reservations before page pixels are built", async () => {
		const atlasBuilder = new FixtureAtlasBuilder();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const intent = createTerrainIntent();

		const reservation = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [intent],
			jobPrefix: "fixture-terrain",
			ownerId: ownerId("static-layer:terrain:0xda55ffff"),
			textureClaims,
		});

		expect(reservation.bindingPlacements).toEqual([
			expect.objectContaining({
				bindingId: intent.bindingId,
				placement: expect.objectContaining({
					itemId: "terrain:item:1",
					rect: [96, 96, 1, 1],
				}),
			}),
		]);
		expect(reservation.pageBuildRequests).toEqual([
			expect.objectContaining({
				entries: [
					expect.objectContaining({
						dataUse: intent.source.dataUse,
						rect: [96, 96, 1, 1],
					}),
				],
			}),
		]);
	});
});

class FixtureAtlasBuilder implements OpenWorldMaterialTextureAtlasBuilder {
	readonly inputs: OpenWorldMaterialTextureAtlasBuildInput[] = [];

	async planAtlasPlacement(
		input: OpenWorldMaterialTextureAtlasBuildInput,
	): Promise<OpenWorldMaterialTextureAtlasPlacementOutput> {
		this.inputs.push(input);
		return {
			pages: [
				{
					height: 256,
					pageId: "fixture-page",
					width: 256,
				},
			],
			rects: input.entries.map((entry) => ({
				entryKey: entry.entryId,
				pageId: "fixture-page",
				rect: [96, 96, 1, 1] as const,
			})),
			stageTimings: [],
		};
	}
}

function createTerrainIntent(): TexturePlacementIntent {
	const source = createTextureUse();
	return {
		affinityKey: "terrain:da55ffff",
		bindingId: bindingId("terrain-binding:color:1"),
		domain: "outdoor-terrain",
		itemId: "terrain:item:1",
		ownerIds: [],
		pageClass: pageClass("page-class:terrain-color"),
		placementPolicy: staticDomainPolicy(),
		purpose: "terrain-color",
		source: {
			dataUse: source,
			kind: "material-texture-data-use",
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "repeat",
			},
		},
		textureKey: textureKey("texture:terrain-color:1"),
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

class FixturePreparedAssetReader implements PreparedAssetReader {
	requestPreparedAsset(): Promise<PreparedAsset> {
		return Promise.resolve({
			key: createPreparedTextureHostKey(createTextureUse()),
			payload: createPreparedTexturePayload(),
			preparedAt: "test",
			revision: 1,
			sourceAssetId: "prepared-texture/06000010",
		});
	}
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

function staticDomainPolicy(): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "static-domain" },
		ownerCurrentness: { kind: "placement-plan-owner" },
		pageBuild: { kind: "worker-owned" },
		sourceStability: { kind: "content-stable" },
	};
}
