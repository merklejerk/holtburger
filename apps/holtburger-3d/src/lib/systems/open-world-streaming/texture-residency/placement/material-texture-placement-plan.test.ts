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
import type {
	OpenWorldMaterialTextureAtlasBuildInput,
	OpenWorldMaterialTextureAtlasPlacementOutput,
	OpenWorldMaterialTextureAtlasBuilder,
} from "../atlas-build/object-visual-atlas-builder";
import { reserveMaterialTexturePlacements } from "./material-texture-placement-plan";

describe("reserveMaterialTexturePlacements", () => {
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

	it("reuses resident entry placements without planning another page build", async () => {
		const atlasBuilder = new FixtureAtlasBuilder();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const intent = createTerrainIntent();
		const owner = ownerId("static-layer:terrain:0xda55ffff");

		const first = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [intent],
			jobPrefix: "fixture-terrain",
			ownerId: owner,
			textureClaims,
		});
		const firstPageBuild = first.pageBuildRequests[0];
		expect(firstPageBuild).toBeDefined();
		textureClaims.acceptPageBuild(
			firstPageBuild.pageId,
			firstPageBuild.reservationToken,
		);

		const reused = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [intent],
			jobPrefix: "fixture-terrain",
			ownerId: owner,
			textureClaims,
		});

		expect(atlasBuilder.inputs).toHaveLength(1);
		expect(reused.pageBuildRequests).toEqual([]);
		expect(reused.textureCommits).toEqual([
			expect.objectContaining({
				bindingUpdates: [
					expect.objectContaining({
						bindingId: intent.bindingId,
						readiness: expect.objectContaining({
							kind: "resident",
							textureRefId: `${firstPageBuild.pageId}:texture`,
						}),
					}),
				],
				pageUpdates: [],
			}),
		]);
		expect(reused.bindingPlacements).toEqual([
			expect.objectContaining({
				bindingId: intent.bindingId,
				placement: expect.objectContaining({
					pageId: firstPageBuild.pageId,
					rect: [96, 96, 1, 1],
					textureRefId: `${firstPageBuild.pageId}:texture`,
				}),
			}),
		]);
		expect(textureClaims.createSnapshot()).toMatchObject({
			entryCount: 1,
			pageCount: 1,
			pageCountByState: {
				resident: 1,
			},
		});
	});

	it("inserts new entries into resident page free space without moving existing entries", async () => {
		const atlasBuilder = new FixtureAtlasBuilder();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const firstIntent = createTerrainIntent({
			affinityKey: "object:shared",
			bindingId: bindingId("object-binding:first"),
			domain: "outdoor-buildings",
			itemId: "object:item:first",
			textureKey: textureKey("texture:object:first"),
		});
		const secondIntent = createTerrainIntent({
			affinityKey: "object:shared",
			bindingId: bindingId("object-binding:second"),
			domain: "outdoor-buildings",
			itemId: "object:item:second",
			sourceKey: "prepared:06000011:rgba-color",
			textureKey: textureKey("texture:object:second"),
		});

		const first = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [firstIntent],
			jobPrefix: "fixture-object",
			ownerId: ownerId("static-layer:object:first"),
			textureClaims,
		});
		const firstPageBuild = first.pageBuildRequests[0];
		expect(firstPageBuild).toBeDefined();
		textureClaims.acceptPageBuild(
			firstPageBuild.pageId,
			firstPageBuild.reservationToken,
		);

		const inserted = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [secondIntent],
			jobPrefix: "fixture-object",
			ownerId: ownerId("static-layer:object:second"),
			textureClaims,
		});

		expect(atlasBuilder.inputs).toHaveLength(2);
		expect(inserted.pageBuildRequests).toHaveLength(1);
		expect(inserted.pageBuildRequests[0]).toMatchObject({
			entries: expect.arrayContaining([
				expect.objectContaining({
					bindingIds: [firstIntent.bindingId],
					rect: [96, 96, 1, 1],
				}),
				expect.objectContaining({
					bindingIds: [secondIntent.bindingId],
				}),
			]),
			pageId: firstPageBuild.pageId,
		});
		expect(inserted.bindingPlacements).toEqual([
			expect.objectContaining({
				bindingId: secondIntent.bindingId,
				placement: expect.objectContaining({
					pageId: firstPageBuild.pageId,
					textureRefId: `${firstPageBuild.pageId}:texture`,
				}),
			}),
		]);
		expect(textureClaims.createSnapshot()).toMatchObject({
			entryCount: 2,
			pageBuildsInFlight: 1,
			pageCount: 1,
			pageCountByState: {
				building: 1,
			},
		});
	});

	it("reuses in-flight entry placements without planning another page build", async () => {
		const atlasBuilder = new FixtureAtlasBuilder();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const firstIntent = createTerrainIntent({
			bindingId: bindingId("terrain-binding:color:first"),
			itemId: "terrain:item:first",
		});
		const secondIntent = createTerrainIntent({
			bindingId: bindingId("terrain-binding:color:second"),
			itemId: "terrain:item:second",
		});

		const first = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [firstIntent],
			jobPrefix: "fixture-terrain",
			ownerId: ownerId("static-layer:terrain:first"),
			textureClaims,
		});
		const firstPageBuild = first.pageBuildRequests[0];
		expect(firstPageBuild).toBeDefined();

		const reused = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [secondIntent],
			jobPrefix: "fixture-terrain",
			ownerId: ownerId("static-layer:terrain:second"),
			textureClaims,
		});

		expect(atlasBuilder.inputs).toHaveLength(1);
		expect(reused.pageBuildRequests).toEqual([]);
		expect(reused.textureCommits).toEqual([]);
		expect(reused.bindingPlacements).toEqual([
			expect.objectContaining({
				bindingId: secondIntent.bindingId,
				placement: expect.objectContaining({
					itemId: "terrain:item:second",
					pageId: firstPageBuild.pageId,
					rect: [96, 96, 1, 1],
					textureRefId: `${firstPageBuild.pageId}:texture`,
				}),
			}),
		]);
		expect(textureClaims.createSnapshot()).toMatchObject({
			claimCount: 2,
			entryCount: 1,
			pageBuildsInFlight: 1,
			pageCount: 1,
			pageCountByState: {
				building: 1,
			},
		});
	});

	it("reuses reclaimable resident placements when a texture entry is claimed again", async () => {
		const atlasBuilder = new FixtureAtlasBuilder();
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const intent = createTerrainIntent();
		const firstOwner = ownerId("static-layer:terrain:first");
		const secondOwner = ownerId("static-layer:terrain:second");

		const first = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [intent],
			jobPrefix: "fixture-terrain",
			ownerId: firstOwner,
			textureClaims,
		});
		const firstPageBuild = first.pageBuildRequests[0];
		expect(firstPageBuild).toBeDefined();
		textureClaims.acceptPageBuild(
			firstPageBuild.pageId,
			firstPageBuild.reservationToken,
		);
		textureClaims.releaseTextureOwner(firstOwner);

		const reused = await reserveMaterialTexturePlacements<
			string,
			TexturePlacementIntent
		>({
			atlasBuilder,
			filteringMode: "nearest",
			intents: [intent],
			jobPrefix: "fixture-terrain",
			ownerId: secondOwner,
			textureClaims,
		});

		expect(atlasBuilder.inputs).toHaveLength(1);
		expect(reused.pageBuildRequests).toEqual([]);
		expect(reused.textureCommits).toEqual([
			expect.objectContaining({
				bindingUpdates: [
					expect.objectContaining({
						bindingId: intent.bindingId,
						readiness: expect.objectContaining({
							kind: "resident",
							textureRefId: `${firstPageBuild.pageId}:texture`,
						}),
					}),
				],
				pageUpdates: [],
			}),
		]);
		expect(reused.bindingPlacements[0]?.placement).toMatchObject({
			pageId: firstPageBuild.pageId,
			textureRefId: `${firstPageBuild.pageId}:texture`,
		});
		expect(textureClaims.createSnapshot()).toMatchObject({
			claimCount: 1,
			entryCount: 1,
			pageCount: 1,
			pageCountByState: {
				resident: 1,
			},
		});
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
			sourceFacts: input.entries.map((entry) => ({
				entryKey: entry.entryId,
				format: input.page.format,
				height: 1,
				width: 1,
			})),
			stageTimings: [],
		};
	}
}

function createTerrainIntent(
	overrides: Partial<TexturePlacementIntent> = {},
): TexturePlacementIntent {
	const source = createTextureUse();
	return {
		affinityKey: overrides.affinityKey ?? "terrain:da55ffff",
		bindingId: overrides.bindingId ?? bindingId("terrain-binding:color:1"),
		domain: overrides.domain ?? "outdoor-terrain",
		itemId: overrides.itemId ?? "terrain:item:1",
		ownerIds: [],
		pageClass: overrides.pageClass ?? pageClass("page-class:terrain-color"),
		placementPolicy: staticDomainPolicy(),
		purpose: overrides.purpose ?? "terrain-color",
		source: overrides.source ?? {
			dataUse: source,
			kind: "material-texture-data-use",
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "repeat",
			},
		},
		sourceKey: overrides.sourceKey ?? "prepared:06000010:rgba-color",
		textureKey: overrides.textureKey ?? textureKey("texture:terrain-color:1"),
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
		sourceStability: { kind: "content-stable" },
	};
}
