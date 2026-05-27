import {
	CompressedTexture,
	DataTexture,
	MeshStandardMaterial,
	RGBAFormat,
	RGBFormat,
	RedFormat,
	RepeatWrapping,
	UnsignedByteType,
	UnsignedShort4444Type,
} from "three";
import { describe, expect, it } from "vitest";

import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedPalettePayload,
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import type { AssetErrorCode, AssetLookupRequestDto } from "../host/contracts";
import {
	WorldMaterialResourceCache,
	formatMaterialAssetId,
} from "./material-resources";
import {
	createBaseMaterialAppearanceContext,
	type MaterialAppearanceContext,
} from "./material-appearance";
import {
	createDefaultMaterialTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-sampling-policy";
import { DIRECT_CLIP_MAP_ALPHA_TEST } from "./material-behavior";

describe("world material resource cache", () => {
	it("builds material plans from resolved surface slots", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000001);
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000001, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createSolidMaterialRecipe(0x08000001, 0xff336699),
				),
			},
			fallbackColorKey: "part",
		});

		expect(plan.signature).toBe(
			`base|parts=base|textures=base|palette=base|0:134217729:${materialAssetId}:variant=base`,
		);
		expect(plan.geometrySlots).toEqual([
			{ surfaceId: 0, materialVariantSignature: null, materialIndex: 0 },
		]);
		expect(plan.materials).toHaveLength(1);
		expect(plan.materials[0]).toBeInstanceOf(MeshStandardMaterial);
		cache.dispose();
	});

	it("separates material plans and material cache entries by variant signature", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000001);
		const preparedByAssetId = {
			[materialAssetId]: createPreparedAsset(
				materialAssetId,
				createSolidMaterialRecipe(0x08000001, 0xff336699),
			),
		};
		const clampPlan = cache.resolveMaterialPlan({
			slots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000001,
					materialAssetId,
					materialVariantSignature: "sampler=clamp",
				},
			],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId,
			fallbackColorKey: "part",
		});
		const repeatPlan = cache.resolveMaterialPlan({
			slots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000001,
					materialAssetId,
					materialVariantSignature: "sampler=repeat",
				},
			],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId,
			fallbackColorKey: "part",
		});

		expect(clampPlan.signature).not.toBe(repeatPlan.signature);
		expect(clampPlan.geometrySlots).toEqual([
			{
				surfaceId: 0,
				materialVariantSignature: "sampler=clamp",
				materialIndex: 0,
			},
		]);
		expect(repeatPlan.geometrySlots).toEqual([
			{
				surfaceId: 0,
				materialVariantSignature: "sampler=repeat",
				materialIndex: 0,
			},
		]);
		expect(clampPlan.materials[0]).not.toBe(repeatPlan.materials[0]);
		cache.dispose();
	});

	it("keeps duplicate slot indices when variants differ", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000001);
		const plan = cache.resolveMaterialPlan({
			slots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000001,
					materialAssetId,
					materialVariantSignature: "sampler=clamp",
				},
				{
					slotIndex: 0,
					surfaceId: 0x08000001,
					materialAssetId,
					materialVariantSignature: "sampler=repeat",
				},
			],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createSolidMaterialRecipe(0x08000001, 0xff336699),
				),
			},
			fallbackColorKey: "part",
		});

		expect(plan.materials).toHaveLength(2);
		expect(plan.geometrySlots).toEqual([
			{
				surfaceId: 0,
				materialVariantSignature: "sampler=clamp",
				materialIndex: 0,
			},
			{
				surfaceId: 0,
				materialVariantSignature: "sampler=repeat",
				materialIndex: 1,
			},
		]);
		cache.dispose();
	});

	it("uses direct-color render-surface bytes for texture-backed materials", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000002);
		const renderSurfaceAssetId = "render-surface/06000002";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000002, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000002, 0x06000002),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createRenderSurfacePayload(0x06000002),
				),
			},
			fallbackColorKey: "part",
		});

		const material = plan.materials[0];
		expect(material).toBeInstanceOf(MeshStandardMaterial);
		const standardMaterial = material as MeshStandardMaterial;
		expect(standardMaterial.map).not.toBeNull();
		expect(standardMaterial.metalness).toBe(0);
		expect(standardMaterial.roughness).toBe(1);
		expect(standardMaterial.envMapIntensity).toBe(0);
		cache.dispose();
	});

	it("uses the first render surface provided by the material DTO", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000012);
		const highDetailSurfaceAssetId = "render-surface/06000012";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000012, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000012, 0x06000012, {
						selectedRenderSurfaceId: 0x06000012,
					}),
				),
				[highDetailSurfaceAssetId]: createPreparedAsset(
					highDetailSurfaceAssetId,
					createRenderSurfacePayload(0x06000012, {
						sourceBytes: new Uint8Array([0x10, 0x20, 0x30, 0xff]),
					}),
				),
			},
			fallbackColorKey: "part",
		});

		const material = plan.materials[0] as MeshStandardMaterial;
		const texture = material.map as DataTexture;
		expect([...texture.image.data.slice(0, 4)]).toEqual([
			0x30, 0x20, 0x10, 0xff,
		]);
		cache.dispose();
	});

	it("applies scalar material behavior to texture-backed materials", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000022);
		const renderSurfaceAssetId = "render-surface/06000022";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000022, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000022, 0x06000022, {
						surfaceType: 0x2 | 0x20 | 0x40,
						translucency: 0.25,
						diffuse: 0.5,
						luminosity: 0.75,
					}),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createRenderSurfacePayload(0x06000022),
				),
			},
			fallbackColorKey: "part",
		});

		const material = plan.materials[0] as MeshStandardMaterial;
		expect(material.color.r).toBe(0.5);
		expect(material.opacity).toBe(0.75);
		expect(material.transparent).toBe(true);
		expect(material.emissiveIntensity).toBe(0.75);
		cache.dispose();
	});

	it("uses alpha test for direct Base1ClipMap materials", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000023);
		const renderSurfaceAssetId = "render-surface/06000023";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000023, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000023, 0x06000023, {
						surfaceType: 0x4,
					}),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createRenderSurfacePayload(0x06000023),
				),
			},
			fallbackColorKey: "part",
		});

		const material = plan.materials[0] as MeshStandardMaterial;
		expect(material.transparent).toBe(true);
		expect(material.alphaTest).toBe(DIRECT_CLIP_MAP_ALPHA_TEST);
		cache.dispose();
	});

	it("reports unsupported parsed surface flags", () => {
		const diagnostics: string[] = [];
		const materialAssetId = formatMaterialAssetId(0x08000024);
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
			expect(diagnostic.detail.unsupportedSurfaceFlags).toEqual(["Detail"]);
		});

		cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000024, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createSolidMaterialRecipe(0x08000024, 0xffffffff, {
						surfaceType: 0x1 | 0x200 | 0x10000 | 0x20000,
					}),
				),
			},
			fallbackColorKey: "part",
		});

		expect(diagnostics).toEqual([
			"unsupported-surface-flags:material/08000024:197121:Detail",
		]);
		cache.dispose();
	});

	it("uses sampler material variants to select texture wrap policy", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000012);
		const renderSurfaceAssetId = "render-surface/06000012";
		const preparedByAssetId = {
			[materialAssetId]: createPreparedAsset(
				materialAssetId,
				createTextureMaterialRecipe(0x08000012, 0x06000012),
			),
			[renderSurfaceAssetId]: createPreparedAsset(
				renderSurfaceAssetId,
				createRenderSurfacePayload(0x06000012),
			),
		};

		const clampPlan = cache.resolveMaterialPlan({
			slots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000012,
					materialAssetId,
					materialVariantSignature: "sampler=clamp",
				},
			],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId,
			fallbackColorKey: "part",
		});
		const repeatPlan = cache.resolveMaterialPlan({
			slots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000012,
					materialAssetId,
					materialVariantSignature: "sampler=repeat",
				},
			],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId,
			fallbackColorKey: "part",
		});

		expect(
			(clampPlan.materials[0] as MeshStandardMaterial).map?.wrapS,
		).not.toBe(RepeatWrapping);
		expect((repeatPlan.materials[0] as MeshStandardMaterial).map?.wrapS).toBe(
			RepeatWrapping,
		);
		expect((repeatPlan.materials[0] as MeshStandardMaterial).map?.wrapT).toBe(
			RepeatWrapping,
		);
		cache.dispose();
	});

	it("uses compressed DXT render-surface bytes when S3TC upload is available", () => {
		const cache = new WorldMaterialResourceCache(undefined, {
			supportsS3tc: true,
			supportsS3tcSrgb: true,
		});
		const materialAssetId = formatMaterialAssetId(0x08000005);
		const renderSurfaceAssetId = "render-surface/06000005";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000005, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000005, 0x06000005),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createDxtRenderSurfacePayload(0x06000005),
				),
			},
			fallbackColorKey: "part",
		});

		const material = plan.materials[0] as MeshStandardMaterial;
		expect(material.map).toBeInstanceOf(CompressedTexture);
		cache.dispose();
	});

	it("uses prepared compressed mip chains when available", () => {
		const cache = new WorldMaterialResourceCache(undefined, {
			supportsS3tc: true,
			supportsS3tcSrgb: true,
		});
		const materialAssetId = formatMaterialAssetId(0x08000015);
		const renderSurfaceAssetId = "render-surface/06000015";
		const preparedTextureAssetId =
			"prepared-texture/06000015?usage=raw&out=dxt1&mips=retail4&cs=source";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000015, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000015, 0x06000015),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createDxtRenderSurfacePayload(0x06000015),
				),
				[preparedTextureAssetId]: createPreparedAsset(
					preparedTextureAssetId,
					createPreparedDxtTexturePayload(0x06000015),
				),
			},
			fallbackColorKey: "part",
		});

		const texture = (plan.materials[0] as MeshStandardMaterial)
			.map as CompressedTexture;
		expect(texture.mipmaps).toHaveLength(2);
		expect(texture.mipmaps[1]).toMatchObject({ width: 2, height: 2 });
		cache.dispose();
	});

	it("refreshes fallback materials after texture dependencies become prepared", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000002);
		const renderSurfaceAssetId = "render-surface/06000002";
		const recipe = createPreparedAsset(
			materialAssetId,
			createTextureMaterialRecipe(0x08000002, 0x06000002),
		);
		const fallbackPlan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000002, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: recipe,
			},
			fallbackColorKey: "part",
		});
		const texturedPlan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000002, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("base"),
			preparedByAssetId: {
				[materialAssetId]: recipe,
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createRenderSurfacePayload(0x06000002),
				),
			},
			fallbackColorKey: "part",
		});

		expect((fallbackPlan.materials[0] as MeshStandardMaterial).map).toBeNull();
		expect(
			(texturedPlan.materials[0] as MeshStandardMaterial).map,
		).not.toBeNull();
		expect(texturedPlan.materials[0]).not.toBe(fallbackPlan.materials[0]);
		cache.dispose();
	});

	it("reports compressed texture capability misses before drawing a fallback", () => {
		const diagnostics: string[] = [];
		const materialAssetId = formatMaterialAssetId(0x08000006);
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
			expect(diagnostic.detail).toMatchObject({
				materialAssetId,
				format: "Dxt1",
				formatRaw: 0x3154_5844,
			});
		});

		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000006, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("visible-cell"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000006, 0x06000006),
				),
				"render-surface/06000006": createPreparedAsset(
					"render-surface/06000006",
					createDxtRenderSurfacePayload(0x06000006),
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toEqual([
			"compressed-texture-extension-missing:material/08000006:100663302",
		]);
		expect((plan.materials[0] as MeshStandardMaterial).map).toBeNull();
		cache.dispose();
	});

	it("reports missing material recipes before drawing a fallback", () => {
		const diagnostics: string[] = [];
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
			expect(diagnostic.detail).toMatchObject({
				materialAssetId: "material/08000003",
				preparedKind: null,
				preparedMaterialRecipeCount: 0,
			});
		});

		const plan = cache.resolveMaterialPlan({
			slots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000003,
					materialAssetId: "material/08000003",
				},
			],
			appearance: createBaseMaterialAppearanceContext("visible-cell"),
			preparedByAssetId: {},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toEqual(["missing-recipe:material/08000003"]);
		expect(plan.materials[0]).toBeInstanceOf(MeshStandardMaterial);
		cache.dispose();
	});

	it("reports failed material recipe provenance as an asset contract failure", () => {
		const diagnostics: string[] = [];
		const materialAssetId = formatMaterialAssetId(0x08000004);
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
			expect(diagnostic.detail).toMatchObject({
				materialAssetId,
				errorCode: "asset-decode-failed",
				detail: "synthetic decode failure",
			});
		});

		cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000004, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("visible-cell"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createFailedMaterialRecipe(
						0x08000004,
						"asset-decode-failed",
						"synthetic decode failure",
					),
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toEqual([
			"failed-recipe:material/08000004:asset-decode-failed",
		]);
		cache.dispose();
	});

	it("caches palette resources by asset id and prepared state", () => {
		const cache = new WorldMaterialResourceCache();
		const paletteAssetId = "palette/04000001";
		const firstPalette = createPreparedAsset(
			paletteAssetId,
			createPalettePayload(0x04000001, [0xff112233, 0x80445566]),
			"2026-05-23T00:00:00.000Z",
		);
		const secondPalette = createPreparedAsset(
			paletteAssetId,
			createPalettePayload(0x04000001, [0xff112233, 0x80778899]),
			"2026-05-23T00:00:01.000Z",
		);

		const firstResource = cache.getPaletteResource({
			paletteAssetId,
			paletteAsset: firstPalette,
		});
		const cachedResource = cache.getPaletteResource({
			paletteAssetId,
			paletteAsset: firstPalette,
		});
		const refreshedResource = cache.getPaletteResource({
			paletteAssetId,
			paletteAsset: secondPalette,
		});

		expect(firstResource).not.toBeNull();
		expect(cachedResource).toBe(firstResource);
		expect(refreshedResource).not.toBe(firstResource);
		expect(firstResource?.texture.image).toMatchObject({
			width: 2,
			height: 1,
		});
		cache.dispose();
	});

	it("creates derived palette resources from appearance subpalettes", () => {
		const cache = new WorldMaterialResourceCache();
		const basePaletteAssetId = "palette/04000001";
		const subPaletteAssetId = "palette/04000002";
		const preparedByAssetId = {
			[basePaletteAssetId]: createPreparedAsset(
				basePaletteAssetId,
				createPalettePayload(
					0x04000001,
					[0xff000000, 0xff111111, 0xff222222, 0xff333333],
				),
			),
			[subPaletteAssetId]: createPreparedAsset(
				subPaletteAssetId,
				createPalettePayload(
					0x04000002,
					[0xff990000, 0xffaa0000, 0xff00bb00, 0xff0000cc],
				),
			),
		};

		const resource = cache.getDerivedPaletteResource({
			basePaletteAssetId,
			basePaletteAsset: preparedByAssetId[basePaletteAssetId],
			appearance: createPaletteAppearanceContext({
				subPalettes: [{ subId: 0x04000002, offset: 1, numColors: 2 }],
			}),
			preparedByAssetId,
		});

		const data = resource?.texture.image.data as Uint8Array | undefined;
		expect(resource?.colorCount).toBe(4);
		expect(data?.slice(4, 12)).toEqual(
			Uint8Array.from([0xaa, 0x00, 0x00, 0xff, 0x00, 0xbb, 0x00, 0xff]),
		);
		cache.dispose();
	});

	it("uses appearance palette override for indexed materials", () => {
		const diagnostics: string[] = [];
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
		});
		const materialAssetId = formatMaterialAssetId(0x08000020);
		const renderSurfaceAssetId = "render-surface/06000020";
		const recipePaletteAssetId = "palette/04000001";
		const appearancePaletteAssetId = "palette/04000003";

		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000020, materialAssetId }],
			appearance: createPaletteAppearanceContext({ paletteId: 0x04000003 }),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000020, 0x06000020, {
						paletteId: 0x04000001,
					}),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createIndexedRenderSurfacePayload(0x06000020, {
						formatRaw: 0x29,
						format: "P8",
						sourceBytes: new Uint8Array([0, 3]),
						width: 2,
						height: 1,
					}),
				),
				[recipePaletteAssetId]: createPreparedAsset(
					recipePaletteAssetId,
					createPalettePayload(0x04000001, [0xff000000, 0xffffffff]),
				),
				[appearancePaletteAssetId]: createPreparedAsset(
					appearancePaletteAssetId,
					createPalettePayload(
						0x04000003,
						[0xff000000, 0xff111111, 0xff222222, 0xff333333],
					),
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toEqual([]);
		expect(
			(plan.materials[0] as MeshStandardMaterial).userData
				.holtburgerIndexedMaterial,
		).toMatchObject({
			paletteColorCount: 4,
		});
		cache.dispose();
	});

	it("refreshes indexed materials when appearance palette assets change", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000021);
		const renderSurfaceAssetId = "render-surface/06000021";
		const appearance = createPaletteAppearanceContext({
			paletteId: 0x04000003,
		});
		const sharedPreparedByAssetId = {
			[materialAssetId]: createPreparedAsset(
				materialAssetId,
				createTextureMaterialRecipe(0x08000021, 0x06000021, {
					paletteId: 0x04000001,
				}),
			),
			[renderSurfaceAssetId]: createPreparedAsset(
				renderSurfaceAssetId,
				createIndexedRenderSurfacePayload(0x06000021, {
					formatRaw: 0x29,
					format: "P8",
					sourceBytes: new Uint8Array([0, 3]),
					width: 2,
					height: 1,
				}),
			),
			"palette/04000001": createPreparedAsset(
				"palette/04000001",
				createPalettePayload(0x04000001, [0xff000000, 0xffffffff]),
			),
		};

		const firstPlan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000021, materialAssetId }],
			appearance,
			preparedByAssetId: {
				...sharedPreparedByAssetId,
				"palette/04000003": createPreparedAsset(
					"palette/04000003",
					createPalettePayload(
						0x04000003,
						[0xff000000, 0xff111111, 0xff222222, 0xff333333],
					),
					"2026-05-23T00:00:00.000Z",
				),
			},
			fallbackColorKey: "visible-cell",
		});
		const refreshedPlan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000021, materialAssetId }],
			appearance,
			preparedByAssetId: {
				...sharedPreparedByAssetId,
				"palette/04000003": createPreparedAsset(
					"palette/04000003",
					createPalettePayload(
						0x04000003,
						[0xff000000, 0xff111111, 0xff222222, 0xff333333, 0xff444444],
					),
					"2026-05-23T00:00:01.000Z",
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(refreshedPlan.materials[0]).not.toBe(firstPlan.materials[0]);
		expect(
			(refreshedPlan.materials[0] as MeshStandardMaterial).userData
				.holtburgerIndexedMaterial,
		).toMatchObject({
			paletteColorCount: 5,
		});
		cache.dispose();
	});

	it("caches indexed texture resources by render surface decode key", () => {
		const cache = new WorldMaterialResourceCache();
		const renderSurface = createIndexedRenderSurfacePayload(0x06000007, {
			sourceBytes: new Uint8Array([0x01, 0x00, 0x02, 0x00]),
		});
		const samplingPolicy = cache.getDefaultTextureSamplingPolicy(renderSurface);
		const firstResource = cache.getIndexedTextureResource({
			renderSurface,
			samplingPolicy,
		});
		const cachedResource = cache.getIndexedTextureResource({
			renderSurface,
			samplingPolicy,
		});

		expect(firstResource).not.toBeNull();
		expect(cachedResource).toBe(firstResource);
		expect(firstResource?.texture).toBeInstanceOf(DataTexture);
		expect(firstResource?.maxIndex).toBe(2);
		cache.dispose();
	});

	it("separates texture resources by sampling policy", () => {
		const cache = new WorldMaterialResourceCache();
		const renderSurface = createRenderSurfacePayload(0x0600000a);
		const clampedPolicy = cache.getDefaultTextureSamplingPolicy(renderSurface);
		const repeatedPolicy: TextureSamplingPolicy = {
			...clampedPolicy,
			wrapS: "repeat",
			wrapT: "repeat",
		};

		const clampedTexture = cache.getTexture({
			renderSurface,
			samplingPolicy: clampedPolicy,
		});
		const repeatedTexture = cache.getTexture({
			renderSurface,
			samplingPolicy: repeatedPolicy,
		});
		const cachedRepeatedTexture = cache.getTexture({
			renderSurface,
			samplingPolicy: repeatedPolicy,
		});

		expect(clampedTexture).not.toBeNull();
		expect(repeatedTexture).not.toBeNull();
		expect(repeatedTexture).not.toBe(clampedTexture);
		expect(cachedRepeatedTexture).toBe(repeatedTexture);
		cache.dispose();
	});

	it("uses compact direct-color texture upload formats when possible", () => {
		const cache = new WorldMaterialResourceCache(undefined, {
			supportsS3tc: false,
			supportsS3tcSrgb: false,
			supportsPackedRgba4444: true,
		});
		const compactPolicy = {
			...createDefaultMaterialTextureSamplingPolicy().directColor,
			colorSpace: "none" as const,
		};

		const rgbTexture = cache.getTexture({
			renderSurface: createRenderSurfacePayload(0x06000020, {
				formatRaw: 0x14,
				format: "R8G8B8",
				sourceBytes: new Uint8Array([0x11, 0x22, 0x33]),
			}),
			samplingPolicy: compactPolicy,
		}) as DataTexture;
		const xrgbTexture = cache.getTexture({
			renderSurface: createRenderSurfacePayload(0x06000021, {
				formatRaw: 0x16,
				format: "X8R8G8B8",
				sourceBytes: new Uint8Array([0x11, 0x22, 0x33, 0x00]),
			}),
			samplingPolicy: compactPolicy,
		}) as DataTexture;
		const rgba4444Texture = cache.getTexture({
			renderSurface: createRenderSurfacePayload(0x06000022, {
				formatRaw: 0x1a,
				format: "A4R4G4B4",
				sourceBytes: new Uint8Array([0x34, 0x12]),
			}),
			samplingPolicy: createDefaultMaterialTextureSamplingPolicy().directColor,
		}) as DataTexture;
		const landscapeAlphaTexture = cache.getTexture({
			renderSurface: createRenderSurfacePayload(0x06000024, {
				formatRaw: 0xf4,
				format: "CustomLandscapeAlpha",
				sourceBytes: new Uint8Array([0x7f]),
			}),
			samplingPolicy: compactPolicy,
		}) as DataTexture;

		expect(rgbTexture.format).toBe(RGBFormat);
		expect(rgbTexture.internalFormat).toBe("RGB8");
		expect(rgbTexture.type).toBe(UnsignedByteType);
		expect([...rgbTexture.image.data]).toEqual([0x11, 0x22, 0x33]);
		expect(xrgbTexture.format).toBe(RGBFormat);
		expect(xrgbTexture.internalFormat).toBe("RGB8");
		expect([...xrgbTexture.image.data]).toEqual([0x33, 0x22, 0x11]);
		expect(rgba4444Texture.format).toBe(RGBAFormat);
		expect(rgba4444Texture.type).toBe(UnsignedShort4444Type);
		expect([...rgba4444Texture.image.data]).toEqual([0x2341]);
		expect(landscapeAlphaTexture.format).toBe(RedFormat);
		expect(landscapeAlphaTexture.internalFormat).toBe("R8");
		expect(landscapeAlphaTexture.type).toBe(UnsignedByteType);
		expect([...landscapeAlphaTexture.image.data]).toEqual([0x7f]);
		cache.dispose();
	});

	it("expands sRGB RGB uploads to RGBA for WebGL compatibility", () => {
		const cache = new WorldMaterialResourceCache();
		const texture = cache.getTexture({
			renderSurface: createRenderSurfacePayload(0x06000025, {
				formatRaw: 0xf3,
				format: "CustomLandscapeR8G8B8",
				sourceBytes: new Uint8Array([0x11, 0x22, 0x33]),
			}),
			samplingPolicy: createDefaultMaterialTextureSamplingPolicy().directColor,
		}) as DataTexture;

		expect(texture.format).toBe(RGBAFormat);
		expect(texture.internalFormat).toBeNull();
		expect(texture.type).toBe(UnsignedByteType);
		expect([...texture.image.data]).toEqual([0x11, 0x22, 0x33, 0xff]);
		cache.dispose();
	});

	it("falls back to RGBA8888 when packed RGBA4444 upload is unavailable", () => {
		const cache = new WorldMaterialResourceCache(undefined, {
			supportsS3tc: false,
			supportsS3tcSrgb: false,
			supportsPackedRgba4444: false,
		});
		const texture = cache.getTexture({
			renderSurface: createRenderSurfacePayload(0x06000023, {
				formatRaw: 0x1a,
				format: "A4R4G4B4",
				sourceBytes: new Uint8Array([0x34, 0x12]),
			}),
			samplingPolicy: createDefaultMaterialTextureSamplingPolicy().directColor,
		}) as DataTexture;

		expect(texture.format).toBe(RGBAFormat);
		expect(texture.type).toBe(UnsignedByteType);
		expect([...texture.image.data]).toEqual([0x22, 0x33, 0x44, 0x11]);
		cache.dispose();
	});

	it("allows cache-level texture sampling policy overrides", () => {
		const policy = createDefaultMaterialTextureSamplingPolicy();
		const cache = new WorldMaterialResourceCache(undefined, undefined, {
			...policy,
			directColor: {
				...policy.directColor,
				wrapS: "repeat",
				wrapT: "repeat",
			},
		});
		const renderSurface = createRenderSurfacePayload(0x0600000b);
		const texture = cache.getTexture({
			renderSurface,
			samplingPolicy: cache.getDefaultTextureSamplingPolicy(renderSurface),
		});

		expect(texture?.wrapS).toBe(RepeatWrapping);
		expect(texture?.wrapT).toBe(RepeatWrapping);
		cache.dispose();
	});

	it("creates indexed materials instead of unsupported render surface placeholders", () => {
		const diagnostics: string[] = [];
		const materialAssetId = formatMaterialAssetId(0x08000007);
		const renderSurfaceAssetId = "render-surface/06000007";
		const paletteAssetId = "palette/04000001";
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
		});

		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000007, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("visible-cell"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000007, 0x06000007, {
						paletteId: 0x04000001,
					}),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createIndexedRenderSurfacePayload(0x06000007, {
						sourceBytes: new Uint8Array([0x01, 0x00, 0x02, 0x00]),
						defaultPaletteId: 0x04000002,
					}),
				),
				[paletteAssetId]: createPreparedAsset(
					paletteAssetId,
					createPalettePayload(
						0x04000001,
						[0xff000000, 0xffffffff, 0xffff0000],
					),
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toEqual([]);
		expect(
			diagnostics.some((key) => key.startsWith("unsupported-render-surface")),
		).toBe(false);
		const material = plan.materials[0] as MeshStandardMaterial;
		expect(material.map).toBeInstanceOf(DataTexture);
		expect(material.userData.holtburgerIndexedMaterial).toMatchObject({
			format: "index16",
			paletteColorCount: 3,
		});
		cache.dispose();
	});

	it("reports indexed palette index range errors", () => {
		const diagnostics: string[] = [];
		const materialAssetId = formatMaterialAssetId(0x08000008);
		const renderSurfaceAssetId = "render-surface/06000008";
		const paletteAssetId = "palette/04000001";
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
			if (diagnostic.key.startsWith("indexed-texture-index-out-of-range")) {
				expect(diagnostic.detail).toMatchObject({
					paletteSource: "material-recipe",
					maxIndex: 4,
					colorCount: 2,
				});
			}
		});

		cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000008, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("visible-cell"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000008, 0x06000008, {
						paletteId: 0x04000001,
					}),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createIndexedRenderSurfacePayload(0x06000008, {
						formatRaw: 0x29,
						format: "P8",
						sourceBytes: new Uint8Array([0, 4]),
						width: 2,
						height: 1,
					}),
				),
				[paletteAssetId]: createPreparedAsset(
					paletteAssetId,
					createPalettePayload(0x04000001, [0xff000000, 0xffffffff]),
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toContain(
			`indexed-texture-index-out-of-range:${materialAssetId}:${renderSurfaceAssetId}:${paletteAssetId}`,
		);
		cache.dispose();
	});

	it("reports missing palette selection when indexed material has no base or default palette", () => {
		const diagnostics: string[] = [];
		const materialAssetId = formatMaterialAssetId(0x08000009);
		const renderSurfaceAssetId = "render-surface/06000009";
		const cache = new WorldMaterialResourceCache((diagnostic) => {
			diagnostics.push(diagnostic.key);
			if (diagnostic.key.startsWith("indexed-texture-palette-missing")) {
				expect(diagnostic.detail).toMatchObject({
					defaultPaletteId: null,
					recipePaletteId: null,
				});
			}
		});

		cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000009, materialAssetId }],
			appearance: createBaseMaterialAppearanceContext("visible-cell"),
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe(0x08000009, 0x06000009),
				),
				[renderSurfaceAssetId]: createPreparedAsset(
					renderSurfaceAssetId,
					createIndexedRenderSurfacePayload(0x06000009, {
						formatRaw: 0x29,
						format: "P8",
						sourceBytes: new Uint8Array([0]),
						width: 1,
						height: 1,
						defaultPaletteId: null,
					}),
				),
			},
			fallbackColorKey: "visible-cell",
		});

		expect(diagnostics).toContain(
			`indexed-texture-palette-missing:${materialAssetId}:${renderSurfaceAssetId}`,
		);
		cache.dispose();
	});
});

function createPaletteAppearanceContext(options: {
	paletteId?: number | null;
	subPalettes?: {
		subId: number;
		offset: number;
		numColors: number;
	}[];
}): MaterialAppearanceContext {
	const paletteId = options.paletteId ?? null;
	const subPalettes = options.subPalettes ?? [];
	return {
		...createBaseMaterialAppearanceContext("visible-cell"),
		paletteViewSignature: [
			`base=${paletteId === null ? "material" : paletteId.toString(16)}`,
			`sub=${subPalettes
				.map(
					(subPalette) =>
						`${subPalette.subId.toString(16)}@${subPalette.offset}+${subPalette.numColors}`,
				)
				.join(",")}`,
		].join("|"),
		paletteView: {
			paletteId,
			subPalettes,
		},
	};
}

function createSolidMaterialRecipe(
	surfaceId: number,
	argb: number,
	options: Partial<
		Pick<
			PreparedMaterialRecipePayload,
			"surfaceType" | "translucency" | "luminosity" | "diffuse"
		>
	> = {},
): PreparedMaterialRecipePayload {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId,
		surfaceType: options.surfaceType ?? 1,
		source: { kind: "solid-color", argb },
		translucency: options.translucency ?? 0,
		luminosity: options.luminosity ?? 0,
		diffuse: options.diffuse ?? 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createTextureMaterialRecipe(
	surfaceId: number,
	renderSurfaceId: number,
	options: {
		selectedRenderSurfaceId?: number | null;
		paletteId?: number | null;
		renderSurfaceDefaultPaletteIds?: number[];
		surfaceType?: number;
		translucency?: number;
		luminosity?: number;
		diffuse?: number;
	} = {},
): PreparedMaterialRecipePayload {
	const selectedRenderSurfaceId =
		options.selectedRenderSurfaceId === undefined
			? renderSurfaceId
			: options.selectedRenderSurfaceId;
	const paletteId = options.paletteId ?? null;
	const renderSurfaceDefaultPaletteIds =
		options.renderSurfaceDefaultPaletteIds ?? [];
	return {
		...createSolidMaterialRecipe(surfaceId, 0xffffffff, options),
		source: {
			kind: "texture",
			surfaceTextureId: 0x05000002,
			selectedRenderSurfaceId,
			paletteId,
			renderSurfaceDefaultPaletteIds,
		},
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds:
				selectedRenderSurfaceId === null
					? []
					: [
							`render-surface/${selectedRenderSurfaceId
								.toString(16)
								.padStart(8, "0")}`,
						],
			paletteAssetIds: [
				...(paletteId === null
					? []
					: [`palette/${paletteId.toString(16).padStart(8, "0")}`]),
				...renderSurfaceDefaultPaletteIds.map(
					(defaultPaletteId) =>
						`palette/${defaultPaletteId.toString(16).padStart(8, "0")}`,
				),
			],
		},
	};
}

function createFailedMaterialRecipe(
	surfaceId: number,
	errorCode: AssetErrorCode,
	detail: string,
): PreparedMaterialRecipePayload {
	return {
		...createSolidMaterialRecipe(surfaceId, 0xffff00ff),
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode,
			detail,
		},
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
	options: {
		sourceBytes?: Uint8Array;
		formatRaw?: number;
		format?: string;
	} = {},
): PreparedRenderSurfacePayload {
	const sourceBytes =
		options.sourceBytes ?? new Uint8Array([0x33, 0x22, 0x11, 0xff]);
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: options.formatRaw ?? 0x15,
		format: options.format ?? "A8R8G8B8",
		sourceByteLength: sourceBytes.byteLength,
		sourceBytes,
		defaultPaletteId: null,
		dependencies: { paletteAssetIds: [] },
	};
}

function createDxtRenderSurfacePayload(
	renderSurfaceId: number,
): PreparedRenderSurfacePayload {
	return {
		...createRenderSurfacePayload(renderSurfaceId),
		width: 4,
		height: 4,
		formatRaw: 0x3154_5844,
		format: "Dxt1",
		sourceByteLength: 8,
		sourceBytes: new Uint8Array(8),
	};
}

function createPreparedDxtTexturePayload(
	renderSurfaceId: number,
): PreparedTexturePayload {
	return {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "prepared-texture",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		usage: "raw",
		outputFormat: "dxt1",
		mipPolicy: "retail4",
		colorSpace: "source",
		sourceFormatRaw: 0x3154_5844,
		sourceFormat: "Dxt1",
		sourceWidth: 4,
		sourceHeight: 4,
		sourceByteLength: 8,
		sourceHash: "test-source",
		levels: [
			{
				level: 0,
				width: 4,
				height: 4,
				formatRaw: 0x3154_5844,
				format: "Dxt1",
				byteLength: 8,
				bytes: new Uint8Array(8),
			},
			{
				level: 1,
				width: 2,
				height: 2,
				formatRaw: 0x3154_5844,
				format: "Dxt1",
				byteLength: 8,
				bytes: new Uint8Array(8),
			},
		],
		dependencies: { renderSurfaceAssetIds: [] },
		diagnostics: {
			generatedLevelCount: 2,
			generatedByteLength: 16,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	};
}

function createIndexedRenderSurfacePayload(
	renderSurfaceId: number,
	options: {
		sourceBytes: Uint8Array;
		formatRaw?: number;
		format?: string;
		width?: number;
		height?: number;
		defaultPaletteId?: number | null;
	},
): PreparedRenderSurfacePayload {
	return {
		...createRenderSurfacePayload(renderSurfaceId),
		width: options.width ?? 2,
		height: options.height ?? 1,
		formatRaw: options.formatRaw ?? 0x65,
		format: options.format ?? "Index16",
		sourceByteLength: options.sourceBytes.byteLength,
		sourceBytes: options.sourceBytes,
		defaultPaletteId: options.defaultPaletteId ?? null,
		dependencies: {
			paletteAssetIds:
				options.defaultPaletteId === undefined ||
				options.defaultPaletteId === null
					? []
					: [
							`palette/${options.defaultPaletteId.toString(16).padStart(8, "0")}`,
						],
		},
	};
}

function createPreparedAsset(
	assetId: string,
	payload:
		| PreparedMaterialRecipePayload
		| PreparedRenderSurfacePayload
		| PreparedTexturePayload
		| PreparedPalettePayload,
	preparedAt = "2026-05-23T00:00:00.000Z",
): PreparedAssetRecord {
	const request: AssetLookupRequestDto = {
		requestId: assetId,
		assetId,
		priority: "streaming",
	};
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt,
	};
}

function createPalettePayload(
	paletteId: number,
	colorsArgb: number[],
): PreparedPalettePayload {
	return {
		kind: "palette",
		sourceAssetKind: "palette",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "palette",
			errorCode: null,
			detail: null,
		},
		paletteId,
		colorCount: colorsArgb.length,
		colorsArgb: Uint32Array.from(colorsArgb),
	};
}
