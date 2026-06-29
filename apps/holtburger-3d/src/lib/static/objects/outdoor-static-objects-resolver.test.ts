import { describe, expect, it } from "vitest";
import type {
	GfxObjPayloadDto,
	LandblockOutdoorPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
} from "../../../lib/host/contracts";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../../assets/contracts";
import {
	createHostAssetKey,
	describeHostAssetKey,
	formatHostAssetId,
	parseHostAssetId,
} from "../../assets/keys";
import type { StaticResolverJob } from "../contracts";
import { RequestScopedPreparedAssetReader } from "../resolver/worker-asset-reader";
import { OutdoorStaticObjectsResolver } from "./outdoor-static-objects-resolver";

describe("browser outdoor static object resolver", () => {
	it("resolves outdoor building source, geometry, material, and texture facts", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-model", 0x02000010),
				createSetupModelPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-appearance", 0x02000010),
				createSetupAppearancePayload({
					paletteId: 0x04000030,
					subPalettes: [
						{
							numColors: 32,
							offset: 16,
							subId: 0x04000020,
						},
					],
				}),
			),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000020),
				createGfxObjPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000011),
				createMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload({
					renderSurfaceId: 0x06000010,
					surfaceTextureId: 0x05000010,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000020),
				createSurfaceTexturePayload({
					renderSurfaceId: 0x06000020,
					surfaceTextureId: 0x05000020,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload({
					renderSurfaceId: 0x06000010,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000020),
				createRenderSurfacePayload({
					renderSurfaceId: 0x06000020,
				}),
			),
			createPreparedAsset(createHostAssetKey("palette", 0x04000010), {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
			createPreparedAsset(createHostAssetKey("palette", 0x04000020), {
				kind: "palette",
				paletteId: 0x04000020,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
			createPreparedAsset(createHostAssetKey("palette", 0x04000030), {
				kind: "palette",
				paletteId: 0x04000030,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createBuildingRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.domain).toBe("outdoor-buildings");
		expect(payload.scope.objects).toHaveLength(1);
		expect(payload.scope.objects[0]).toMatchObject({
			identity: {
				instanceId: "building-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x02000010,
			},
		});
		expect(payload.scope.sourceAssets).toHaveLength(1);
		expect(payload.scope.sourceAssets[0]).toMatchObject({
			identity: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x02000010,
			},
			materialSlotCount: 1,
			partCount: 1,
			renderTriangleCount: 1,
		});
		expect(payload.scope.sourceAssets[0]?.parts[0]).toMatchObject({
			geometry: {
				kind: "static-object-source-geometry",
				partIndex: 0,
			},
			gfxObj: {
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000020,
			},
			materialSlotCount: 1,
			renderTriangleCount: 1,
		});
		expect(payload.scope.sourceAssets[0]?.parts[0]).not.toHaveProperty(
			"positions",
		);
		expect(payload.scope.sourceAssets[0]?.parts[0]).not.toHaveProperty(
			"normals",
		);
		expect(payload.scope.sourceAssets[0]?.parts[0]).not.toHaveProperty(
			"texCoords",
		);
		expect(payload.scope.materialSlots).toHaveLength(1);
		expect(payload.scope.regionRenderProfile.detailRoles).toEqual([
			{
				fadeFar: 256,
				fadeNear: 128,
				role: "building",
				texture: {
					kind: "surface-texture",
					surfaceTextureId: 0x05000020,
				},
				tiling: 8,
			},
		]);
		expect(payload.scope.materialSlots[0]).toMatchObject({
			identity: {
				geometrySurfaceId: 0,
				materialSurfaceId: 0x08000010,
			},
			material: {
				kind: "static-material-source",
				materialId: 0x08000011,
			},
			paletteOverride: {
				kind: "palette",
				paletteId: 0x04000030,
			},
			paletteViews: [
				{
					firstIndex: 16,
					indexCount: 32,
					palette: {
						kind: "palette",
						paletteId: 0x04000020,
					},
				},
			],
		});
		expect(
			payload.scope.sourceAssets[0]?.parts[0]?.materialSlots[0],
		).toMatchObject({
			paletteOverride: {
				kind: "palette",
				paletteId: 0x04000030,
			},
			paletteViews: [
				{
					firstIndex: 16,
					indexCount: 32,
					palette: {
						kind: "palette",
						paletteId: 0x04000020,
					},
				},
			],
		});
		expect(payload.scope.materialSources).toEqual([
			expect.objectContaining({
				identity: {
					kind: "static-material-source",
					materialId: 0x08000011,
				},
				source: expect.objectContaining({
					kind: "texture",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000010,
					},
				}),
			}),
		]);
		expect(payload.scope.textureRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "surface-texture",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000010,
					},
				}),
				expect.objectContaining({
					palette: {
						kind: "palette",
						paletteId: 0x04000010,
					},
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "render-surface",
				}),
				expect.objectContaining({
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000020,
					},
					role: "surface-texture",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000020,
					},
				}),
				expect.objectContaining({
					palette: {
						kind: "palette",
						paletteId: 0x04000010,
					},
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000020,
					},
					role: "render-surface",
				}),
			]),
		);
		expect(payload.scope.missingRefs).toEqual([]);
	});

	it("classifies setup-backed outdoor objects with default animations as dynamic seeds", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload({
					buildingSourceAssetId: "setup-model/020003e5",
				}),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-model", 0x020003e5),
				createSetupModelPayload({
					defaultAnimation: 0x0300061b,
					setupModelId: 0x020003e5,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("setup-appearance", 0x020003e5),
				createSetupAppearancePayload({ setupModelId: 0x020003e5 }),
			),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000020),
				createGfxObjPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000011),
				createMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload({
					renderSurfaceId: 0x06000010,
					surfaceTextureId: 0x05000010,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload({
					renderSurfaceId: 0x06000010,
				}),
			),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createBuildingRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.objects).toEqual([]);
		expect(payload.scope.materialSlots).toEqual([]);
		expect(payload.scope.authoredDynamicSeeds).toEqual([
			expect.objectContaining({
				classificationReason: "setup-default-animation",
				defaultAnimationId: 0x0300061b,
				domain: "outdoor-buildings",
				landblockId: 0xda55ffff,
				object: expect.objectContaining({
					instanceId: "building-0",
					objectKind: "building",
				}),
				setupModelId: 0x020003e5,
				sourceAssetId: "setup-model/020003e5",
			}),
		]);
		expect(payload.scope.sourceAssets[0]).toMatchObject({
			defaultAnimation: 0x0300061b,
		});
	});

	it("resolves generated scenery without building detail roles", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000030),
				createGfxObjPayload({ gfxObjId: 0x01000030 }),
			),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000010),
				createMaterialPayload({ materialId: 0x08000010 }),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(),
			),
			createPreparedAsset(createHostAssetKey("palette", 0x04000010), {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createGeneratedSceneryRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.domain).toBe("outdoor-generated-scenery");
		expect(payload.scope.regionRenderProfile.detailRoles).toEqual([]);
		expect(payload.scope.objects).toEqual([
			expect.objectContaining({
				generated: {
					sceneId: 1,
					sceneTemplateIndex: 0,
					terrainIndex: 0,
				},
				identity: expect.objectContaining({
					instanceId: "detail-0",
					objectKind: "generated-scenery",
				}),
				source: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000030,
				},
			}),
		]);
		expect(payload.scope.sourceAssets).toEqual([
			expect.objectContaining({
				identity: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000030,
				},
				materialSlotCount: 1,
				partCount: 1,
				renderTriangleCount: 1,
			}),
		]);
		expect(payload.scope.materialSlots).toEqual([
			expect.objectContaining({
				material: {
					kind: "static-material-source",
					materialId: 0x08000010,
				},
			}),
		]);
		expect(payload.scope.textureRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "surface-texture",
				}),
			]),
		);
		expect(payload.scope.textureRefs).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000020,
					},
				}),
			]),
		);
		expect(payload.scope.missingRefs).toEqual([]);
	});

	it("resolves duplicate prepared asset refs through the shared request reader", async () => {
		const duplicatedMaterialKey = createHostAssetKey("material", 0x08000011);
		const duplicatedTextureKey = createHostAssetKey(
			"surface-texture",
			0x05000010,
		);
		const duplicatedRenderSurfaceKey = createHostAssetKey(
			"render-surface",
			0x06000010,
		);
		const duplicatedPaletteKey = createHostAssetKey("palette", 0x04000010);
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-model", 0x02000010),
				createSetupModelPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-appearance", 0x02000010),
				createSetupAppearancePayload({
					materialSlots: [
						{
							materialAssetId: "material/08000011",
							slotIndex: 0,
							surfaceId: 0x08000010,
						},
						{
							materialAssetId: "material/08000011",
							slotIndex: 1,
							surfaceId: 0x08000010,
						},
					],
				}),
			),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000020),
				createGfxObjPayload(),
			),
			createPreparedAsset(duplicatedMaterialKey, createMaterialPayload()),
			createPreparedAsset(
				duplicatedTextureKey,
				createSurfaceTexturePayload({
					renderSurfaceId: 0x06000010,
					surfaceTextureId: 0x05000010,
				}),
			),
			createPreparedAsset(
				duplicatedRenderSurfaceKey,
				createRenderSurfacePayload({ renderSurfaceId: 0x06000010 }),
			),
			createPreparedAsset(duplicatedPaletteKey, {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService: new RequestScopedPreparedAssetReader(assetService),
		}).resolve(createBuildingRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.materialSlots).toHaveLength(2);
		expect(assetService.countRequests(duplicatedMaterialKey)).toBe(1);
		expect(assetService.countRequests(duplicatedTextureKey)).toBe(1);
		expect(assetService.countRequests(duplicatedRenderSurfaceKey)).toBe(1);
		expect(assetService.countRequests(duplicatedPaletteKey)).toBe(1);
	});

	it("returns an empty generated-scenery payload when a landblock has no generated scenery", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload({ includeGeneratedScenery: false }),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createGeneratedSceneryRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.domain).toBe("outdoor-generated-scenery");
		expect(payload.scope.objects).toEqual([]);
		expect(payload.scope.sourceAssets).toEqual([]);
		expect(payload.scope.materialSlots).toEqual([]);
		expect(payload.scope.textureRefs).toEqual([]);
		expect(payload.scope.missingRefs).toEqual([]);
	});

	it("resolves explicit objects through the static object pipeline", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload({
					includeExplicitObject: true,
					includeGeneratedScenery: false,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000031),
				createGfxObjPayload({ gfxObjId: 0x01000031 }),
			),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000010),
				createMaterialPayload({ materialId: 0x08000010 }),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(),
			),
			createPreparedAsset(createHostAssetKey("palette", 0x04000010), {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createExplicitObjectsRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.domain).toBe("outdoor-explicit-objects");
		expect(payload.scope.regionRenderProfile.detailRoles).toEqual([]);
		expect(payload.scope.objects).toEqual([
			expect.objectContaining({
				generated: null,
				identity: expect.objectContaining({
					instanceId: "explicit-0",
					objectKind: "explicit-object",
				}),
				source: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000031,
				},
			}),
		]);
		expect(payload.scope.sourceAssets).toEqual([
			expect.objectContaining({
				identity: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000031,
				},
			}),
		]);
		expect(payload.scope.materialSlots).toHaveLength(1);
		expect(payload.scope.textureRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "surface-texture",
				}),
			]),
		);
		expect(payload.scope.missingRefs).toEqual([]);
	});

	it("reports missing generated-scenery source assets as typed missing refs", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createGeneratedSceneryRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.objects).toEqual([]);
		expect(payload.scope.sourceAssets).toEqual([]);
		expect(payload.scope.missingRefs).toEqual([
			{
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000030,
			},
		]);
	});

	it("expands setup appearance material slots across geometry material variants", async () => {
		const gfxObj = createGfxObjPayload();
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-model", 0x02000010),
				createSetupModelPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-appearance", 0x02000010),
				createSetupAppearancePayload(),
			),
			createPreparedAsset(createHostAssetKey("gfx-obj", 0x01000020), {
				...gfxObj,
				renderGeometry: {
					...gfxObj.renderGeometry,
					triangles: [
						{
							firstVertex: 0,
							materialVariantSignature: "sampler=repeat",
							polygonId: 7,
							surfaceId: 0,
						},
					],
				},
			}),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000011),
				createMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(),
			),
			createPreparedAsset(createHostAssetKey("palette", 0x04000010), {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createBuildingRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.materialSlots).toEqual([
			expect.objectContaining({
				identity: expect.objectContaining({
					geometrySurfaceId: 0,
					materialSurfaceId: 0x08000010,
					slotIndex: 0,
				}),
				material: {
					kind: "static-material-source",
					materialId: 0x08000011,
				},
				materialVariantSignature: "sampler=repeat",
			}),
		]);
		expect(payload.scope.sourceAssets[0]?.parts[0]?.triangles[0]).toMatchObject(
			{
				geometrySurfaceId: 0,
				materialVariantSignature: "sampler=repeat",
			},
		);
	});

	it("keeps host routes confined to debug provenance", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-model", 0x02000010),
				createSetupModelPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("setup-appearance", 0x02000010),
				createSetupAppearancePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000020),
				createGfxObjPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000011),
				createMaterialPayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(),
			),
			createPreparedAsset(createHostAssetKey("palette", 0x04000010), {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createBuildingRequest());
		const withoutDebug = JSON.stringify(payload.scope, (key, value) =>
			key === "debug" ? undefined : value,
		);

		expect(withoutDebug).not.toContain("setup-model/");
		expect(withoutDebug).not.toContain("gfx-obj/");
		expect(withoutDebug).not.toContain("material/");
		expect(withoutDebug).not.toContain("surface-texture/");
		expect(withoutDebug).not.toContain("render-surface/");
		expect(withoutDebug).not.toContain("palette/");
	});

	it("excludes objects whose source asset could not be resolved", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-outdoor", 0xda55ffff),
				createLandblockOutdoorPayload({
					buildingSourceAssetId: "gfx-obj/01000020",
				}),
			),
			createPreparedAsset(
				createHostAssetKey("region-render-profile", 1),
				createRegionRenderProfilePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000020),
				createSurfaceTexturePayload({
					renderSurfaceId: 0x06000020,
					surfaceTextureId: 0x05000020,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000020),
				createRenderSurfacePayload({
					renderSurfaceId: 0x06000020,
				}),
			),
			createPreparedAsset(createHostAssetKey("palette", 0x04000010), {
				kind: "palette",
				paletteId: 0x04000010,
				provenance: createProvenance("palette"),
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			} satisfies PalettePayloadDto),
		]);

		const payload = await new OutdoorStaticObjectsResolver({
			assetService,
		}).resolve(createBuildingRequest());

		expect(payload.scope.kind).toBe("outdoor-static-objects");
		if (payload.scope.kind !== "outdoor-static-objects") {
			throw new Error("expected outdoor static object payload");
		}

		expect(payload.scope.objects).toEqual([]);
		expect(payload.scope.sourceAssets).toEqual([]);
		expect(payload.scope.materialSlots).toEqual([]);
		expect(payload.scope.missingRefs).toEqual([
			{
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000020,
			},
		]);
	});
});

class FixtureAssetService implements AssetService {
	readonly #assets = new Map<string, PreparedAsset>();
	readonly #requestCounts = new Map<string, number>();

	constructor(assets: readonly PreparedAsset[]) {
		for (const asset of assets) {
			this.#assets.set(describeHostAssetKey(asset.key), asset);
		}
	}

	async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		const requestKey = describeHostAssetKey(key);
		this.#requestCounts.set(
			requestKey,
			(this.#requestCounts.get(requestKey) ?? 0) + 1,
		);
		const asset = this.#assets.get(describeHostAssetKey(key));
		if (!asset) {
			throw new Error(`Missing fixture asset ${describeHostAssetKey(key)}.`);
		}

		return asset;
	}

	countRequests(key: HostAssetKey): number {
		return this.#requestCounts.get(describeHostAssetKey(key)) ?? 0;
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		throw new Error(
			`FixtureAssetService does not support leases for ${describeHostAssetKey(
				key,
			)}.`,
		);
	}

	pruneExpiredWarmAssets(): number {
		return 0;
	}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			pending: [],
		};
	}

	createOverviewSnapshot() {
		return {
			committedCount: 0,
			pendingCount: 0,
		};
	}
}

function createPreparedAsset(
	key: HostAssetKey,
	payload: PreparedAsset["payload"],
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-11T00:00:00.000Z",
		revision: 1,
		sourceAssetId: formatHostAssetId(key),
	};
}

function createBuildingRequest(): StaticResolverJob {
	return {
		domain: "outdoor-buildings",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createGeneratedSceneryRequest(): StaticResolverJob {
	return {
		domain: "outdoor-generated-scenery",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createExplicitObjectsRequest(): StaticResolverJob {
	return {
		domain: "outdoor-explicit-objects",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createLandblockOutdoorPayload(
	options: {
		readonly buildingSourceAssetId?: string;
		readonly includeExplicitObject?: boolean;
		readonly includeGeneratedScenery?: boolean;
	} = {},
): LandblockOutdoorPayloadDto {
	const buildingSourceAssetId =
		options.buildingSourceAssetId ?? "setup-model/02000010";
	const buildingSourceKey = parseHostAssetId(buildingSourceAssetId);
	const statics: LandblockOutdoorPayloadDto["statics"] = [
		{
			building: { numLeaves: 1, portals: [] },
			generated: null,
			instanceBounds: createBounds(),
			instanceId: "building-0",
			kind: "building",
			localPlacement: createPlacement(),
			sourceAssetId: buildingSourceAssetId,
			sourceBounds: createBounds(),
			sourceDid: Number.parseInt(buildingSourceKey.id, 16) >>> 0,
			sourceIndex: 0,
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	];
	if (options.includeGeneratedScenery !== false) {
		statics.push({
			building: null,
			generated: { sceneId: 1, sceneTemplateIndex: 0, terrainIndex: 0 },
			instanceBounds: createBounds(),
			instanceId: "detail-0",
			kind: "generated-scenery",
			localPlacement: createPlacement(),
			sourceAssetId: "gfx-obj/01000030",
			sourceBounds: createBounds(),
			sourceDid: 0x01000030,
			sourceIndex: 1,
			sourceScale: { x: 1, y: 1, z: 1 },
		});
	}
	if (options.includeExplicitObject === true) {
		statics.push({
			building: null,
			generated: null,
			instanceBounds: createBounds(),
			instanceId: "explicit-0",
			kind: "explicit-object",
			localPlacement: createPlacement(),
			sourceAssetId: "gfx-obj/01000031",
			sourceBounds: createBounds(),
			sourceDid: 0x01000031,
			sourceIndex: 2,
			sourceScale: { x: 1, y: 1, z: 1 },
		});
	}

	return {
		classification: "outdoor",
		diagnostics: { errors: [], omissions: [], sourceRecords: [] },
		kind: "landblock-outdoor",
		landblockId: 0xda55ffff,
		outdoorBvh: {
			coordinateSpace: "landblock-render-local",
			items: statics.map((object) => ({
				instanceId: object.instanceId,
				kind: object.kind,
			})),
			nodes: [],
		},
		provenance: createProvenance("landblock-outdoor"),
		regionId: 1,
		regionNumber: 1,
		residencyKind: "outdoor-landblock",
		sourceAssetKind: "landblock-outdoor",
		statics,
		terrain: createTerrainStub(),
	};
}

function createSetupModelPayload(
	options: {
		readonly defaultAnimation?: number | null;
		readonly setupModelId?: number;
	} = {},
): SetupModelPayloadDto {
	const setupModelId = options.setupModelId ?? 0x02000010;
	return {
		collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
		connectionPoints: [],
		defaultAnimation: options.defaultAnimation ?? null,
		defaultMotionTable: null,
		defaultScript: null,
		defaultScriptTable: null,
		defaultSoundTable: null,
		dependencies: { gfxObjAssetIds: ["gfx-obj/01000020"] },
		flags: null,
		height: null,
		holdingLocations: [],
		kind: "setup-model",
		lights: [],
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				parentIndex: null,
				partIndex: 0,
				scale: null,
			},
		],
		placementSets: [],
		provenance: createProvenance("setup-model"),
		radius: null,
		residencyKind: "unknown",
		selectionSphere: null,
		setupModelId,
		sortingSphere: null,
		sourceAssetKind: "setup-model",
		stepDown: null,
		stepUp: null,
	};
}

function createRegionRenderProfilePayload(): RegionRenderProfilePayloadDto {
	const buildingDetailRole = {
		fadeFar: 256,
		fadeNear: 128,
		role: "building" as const,
		sourceTerrainDescIndex: 0,
		textureAssetId: "surface-texture/05000020",
		textureDid: 0x05000020,
		tiling: 8,
	};

	return {
		dependencies: {
			paletteAssetIds: [],
			renderSurfaceAssetIds: ["render-surface/06000020"],
			surfaceTextureAssetIds: ["surface-texture/05000020"],
		},
		detailRoles: {
			building: buildingDetailRole,
			environment: null,
			landscape: null,
			object: null,
		},
		kind: "region-render-profile",
		provenance: createProvenance("region-render-profile"),
		regionId: 1,
		regionNumber: 1,
		residencyKind: "unknown",
		sourceAssetKind: "region-render-profile",
	};
}

function createSetupAppearancePayload(
	options: {
		readonly materialSlots?: SetupAppearancePayloadDto["parts"][number]["materialSlots"];
		readonly paletteId?: number | null;
		readonly setupModelId?: number;
		readonly subPalettes?: SetupAppearancePayloadDto["subPalettes"];
	} = {},
): SetupAppearancePayloadDto {
	const setupModelId = options.setupModelId ?? 0x02000010;
	return {
		animPartChanges: [],
		appearanceKey: `setup-appearance/${setupModelId.toString(16).padStart(8, "0")}`,
		dependencies: {
			materialAssetIds: ["material/08000011"],
			paletteAssetIds: [],
		},
		kind: "setup-appearance",
		paletteId: options.paletteId ?? null,
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				materialSlots: options.materialSlots ?? [
					{
						materialAssetId: "material/08000011",
						slotIndex: 0,
						surfaceId: 0x08000010,
					},
				],
				partIndex: 0,
			},
		],
		provenance: createProvenance("setup-appearance"),
		residencyKind: "unknown",
		setupModelId,
		sourceAssetKind: "setup-appearance",
		subPalettes: options.subPalettes ?? [],
		textureChanges: [],
	};
}

function createGfxObjPayload(
	options: { readonly gfxObjId?: number } = {},
): GfxObjPayloadDto {
	const gfxObjId = options.gfxObjId ?? 0x01000020;

	return {
		dependencies: { materialAssetIds: ["material/08000010"] },
		didDegrade: null,
		drawingBsp: null,
		drawingPolygons: [],
		flags: null,
		gfxObjId,
		kind: "gfx-obj",
		physicsWitness: { hasBsp: false, polygonCount: 1, rootKind: null },
		provenance: createProvenance("gfx-obj"),
		renderGeometry: {
			bounds: createBounds(),
			invalidPolygons: [],
			normals: [],
			positions: [],
			skippedPolygonCount: 0,
			sourceId: gfxObjId,
			surfaceIds: [0x08000010],
			triangleCount: 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: null,
					polygonId: 7,
					surfaceId: 0x08000010,
				},
			],
			uvs: [],
			vertexCount: 3,
		},
		residencyKind: "unknown",
		sortCenter: null,
		sourceAssetKind: "gfx-obj",
		surfaceIds: [0x08000010],
		vertexArray: { vertices: [] },
	};
}

function createMaterialPayload(
	options: {
		readonly materialId?: number;
		readonly surfaceType?: number;
	} = {},
): MaterialRecipePayloadDto {
	const materialId = options.materialId ?? 0x08000011;

	return {
		dependencies: {
			paletteAssetIds: ["palette/04000010"],
			renderSurfaceAssetIds: ["render-surface/06000010"],
			surfaceTextureAssetIds: ["surface-texture/05000010"],
		},
		diffuse: 1,
		kind: "material-recipe",
		luminosity: 0,
		provenance: createProvenance("material-recipe"),
		residencyKind: "unknown",
		source: {
			kind: "texture",
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [0x04000010],
			selectedRenderSurfaceId: 0x06000010,
			surfaceTextureId: 0x05000010,
		},
		sourceAssetKind: "material-recipe",
		surfaceId: materialId,
		surfaceType: options.surfaceType ?? 0,
		translucency: 0,
	};
}

function createSurfaceTexturePayload(
	options: {
		readonly surfaceTextureId: number;
		readonly renderSurfaceId: number;
	} = {
		renderSurfaceId: 0x06000010,
		surfaceTextureId: 0x05000010,
	},
): SurfaceTexturePayloadDto {
	return {
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
		kind: "surface-texture",
		provenance: createProvenance("surface-texture"),
		renderSurfaceIds: [options.renderSurfaceId],
		residencyKind: "unknown",
		selectedRenderSurfaceId: options.renderSurfaceId,
		sourceAssetKind: "surface-texture",
		surfaceTextureId: options.surfaceTextureId,
		textureType: 0,
		unknown: 0,
	};
}

function createRenderSurfacePayload(
	options: {
		readonly renderSurfaceId: number;
	} = {
		renderSurfaceId: 0x06000010,
	},
): RenderSurfacePayloadDto {
	return {
		defaultPaletteId: 0x04000010,
		dependencies: { paletteAssetIds: ["palette/04000010"] },
		format: "p8",
		formatRaw: 1,
		height: 1,
		kind: "render-surface",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: options.renderSurfaceId,
		residencyKind: "unknown",
		sourceAssetKind: "render-surface",
		sourceByteLength: 1,
		sourceBytes: new Uint8Array([0]),
		unknown: 0,
		width: 1,
	};
}

function createTerrainStub(): LandblockOutdoorPayloadDto["terrain"] {
	return {
		bounds: createBounds(),
		gridSize: 2,
		maxHeight: 0,
		minHeight: 0,
		quads: [],
		terrainBvh: {
			coordinateSpace: "landblock-outdoor-terrain-local",
			items: [],
			nodes: [],
		},
		tileSize: 24,
		triangles: [],
		vertices: [],
	};
}

function createBounds() {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind,
	};
}
