import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
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
			slots: [{ surfaceId: 0x08000001, materialAssetId }],
			appearanceKey: "base",
			preparedByAssetId: {
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createSolidMaterialRecipe(0x08000001, 0xff336699),
				),
			},
			fallbackColorKey: "part",
		});

		expect(plan.signature).toBe(`base|134217729:${materialAssetId}`);
		expect(plan.geometrySlots).toEqual([
			{ surfaceId: 0x08000001, materialIndex: 0 },
		]);
		expect(plan.materials).toHaveLength(1);
		expect(plan.materials[0]).toBeInstanceOf(MeshStandardMaterial);
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

function createPreparedAsset(
	assetId: string,
	payload: PreparedMaterialRecipePayload,
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
