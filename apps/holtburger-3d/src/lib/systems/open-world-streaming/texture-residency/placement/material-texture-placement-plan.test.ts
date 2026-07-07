import { describe, expect, it } from "vitest";

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
			pageBuilder: new DirectOpenWorldTexturePageBuilder(),
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
					rect: [96, 96, 2, 2],
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
							rect: [96, 96, 2, 2],
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
					rect: [96, 96, 2, 2],
				}),
			}),
		]);
		expect(reservation.pageBuildRequests).toEqual([
			expect.objectContaining({
				entries: [
					expect.objectContaining({
						rect: [96, 96, 2, 2],
						source: expect.objectContaining({
							kind: "open-world-texture-page-build-pixel-source",
							pixels: expect.any(Uint8Array),
						}),
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
				rect: [96, 96, 2, 2] as const,
			})),
			sources: input.entries.map((entry) => ({
				entry,
				source: {
					format: "rgba8",
					height: 2,
					kind: "texture-packing-pixel-source",
					pixels: new Uint8Array(2 * 2 * 4),
					width: 2,
				},
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
