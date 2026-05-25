import { CompressedTexture, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedPalettePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import type { AssetErrorCode, AssetLookupRequestDto } from "../host/contracts";
import {
	WorldMaterialResourceCache,
	formatMaterialAssetId,
} from "./material-resources";

describe("world material resource cache", () => {
	it("builds material plans from resolved surface slots", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000001);
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000001, materialAssetId }],
			appearanceKey: "base",
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createSolidMaterialRecipe(0x08000001, 0xff336699),
				),
			},
			fallbackColorKey: "part",
		});

		expect(plan.signature).toBe(`base|0:134217729:${materialAssetId}`);
		expect(plan.geometrySlots).toEqual([{ surfaceId: 1, materialIndex: 0 }]);
		expect(plan.materials).toHaveLength(1);
		expect(plan.materials[0]).toBeInstanceOf(MeshStandardMaterial);
		cache.dispose();
	});

	it("uses direct-color render-surface bytes for texture-backed materials", () => {
		const cache = new WorldMaterialResourceCache();
		const materialAssetId = formatMaterialAssetId(0x08000002);
		const renderSurfaceAssetId = "render-surface/06000002";
		const plan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000002, materialAssetId }],
			appearanceKey: "base",
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
		expect((material as MeshStandardMaterial).map).not.toBeNull();
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
			appearanceKey: "base",
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
			appearanceKey: "base",
			preparedByAssetId: {
				[materialAssetId]: recipe,
			},
			fallbackColorKey: "part",
		});
		const texturedPlan = cache.resolveMaterialPlan({
			slots: [{ slotIndex: 0, surfaceId: 0x08000002, materialAssetId }],
			appearanceKey: "base",
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
			appearanceKey: "visible-cell",
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
			appearanceKey: "visible-cell",
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
			appearanceKey: "visible-cell",
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
});

function createSolidMaterialRecipe(
	surfaceId: number,
	argb: number,
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
		surfaceType: 1,
		source: { kind: "solid-color", argb },
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			renderTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createTextureMaterialRecipe(
	surfaceId: number,
	renderSurfaceId: number,
): PreparedMaterialRecipePayload {
	const renderSurfaceAssetId = `render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`;
	return {
		...createSolidMaterialRecipe(surfaceId, 0xffffffff),
		source: {
			kind: "texture",
			renderTextureId: 0x05000002,
			renderSurfaceIds: [renderSurfaceId],
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		},
		dependencies: {
			renderTextureAssetIds: [],
			renderSurfaceAssetIds: [renderSurfaceAssetId],
			paletteAssetIds: [],
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
): PreparedRenderSurfacePayload {
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
		formatRaw: 0x15,
		format: "A8R8G8B8",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([0x33, 0x22, 0x11, 0xff]),
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

function createPreparedAsset(
	assetId: string,
	payload:
		| PreparedMaterialRecipePayload
		| PreparedRenderSurfacePayload
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
