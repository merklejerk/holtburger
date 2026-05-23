import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import type { AssetLookupRequestDto } from "../host/contracts";
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
			renderSurfaceAssetIds: ["render-surface/06000002"],
			paletteAssetIds: [],
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

function createPreparedAsset(
	assetId: string,
	payload: PreparedMaterialRecipePayload | PreparedRenderSurfacePayload,
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
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}
