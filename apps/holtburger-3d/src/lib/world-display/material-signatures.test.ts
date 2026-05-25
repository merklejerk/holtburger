import { describe, expect, it } from "vitest";

import { createBaseMaterialAppearanceContext } from "./material-appearance";
import {
	describeMaterialCacheKey,
	describeMaterialPreparedStateSignature,
	formatMaterialAssetId,
} from "./material-signatures";

describe("material signatures", () => {
	it("keys missing material state by appearance facts and asset id", () => {
		const appearance = createBaseMaterialAppearanceContext("base");
		const materialAssetId = formatMaterialAssetId(0x08000001);

		expect(
			describeMaterialCacheKey({
				appearance,
				materialAssetId,
				preparedByAssetId: {},
			}),
		).toBe(
			"base|parts=base|textures=base|palette=base|material/08000001|variant=base|material/08000001:missing|appearance-palettes=base",
		);
	});

	it("separates final material cache keys by immutable material variant", () => {
		const appearance = createBaseMaterialAppearanceContext("base");
		const materialAssetId = formatMaterialAssetId(0x08000001);

		expect(
			describeMaterialCacheKey({
				appearance,
				materialAssetId,
				materialVariantSignature: "sampler=repeat",
				preparedByAssetId: {},
			}),
		).not.toBe(
			describeMaterialCacheKey({
				appearance,
				materialAssetId,
				materialVariantSignature: "sampler=clamp",
				preparedByAssetId: {},
			}),
		);
	});

	it("keeps appearance signatures source agnostic", () => {
		const directObjDescAppearance = {
			appearanceKey: "setup:0x02000010|resolved",
			selectedPartsSignature: "0=01000001",
			textureSwapSignature: "2:05000001>05000002",
			paletteViewSignature: "base=04000001;sub=04000002@12+8",
			paletteView: {
				paletteId: 0x04000001,
				subPalettes: [{ subId: 0x04000002, offset: 12, numColors: 8 }],
			},
		};
		const clothingGeneratedAppearance = { ...directObjDescAppearance };

		expect(
			describeMaterialCacheKey({
				appearance: directObjDescAppearance,
				materialAssetId: "material/08000001",
				preparedByAssetId: {},
			}),
		).toBe(
			describeMaterialCacheKey({
				appearance: clothingGeneratedAppearance,
				materialAssetId: "material/08000001",
				preparedByAssetId: {},
			}),
		);
	});

	it("describes absent prepared dependencies explicitly", () => {
		expect(
			describeMaterialPreparedStateSignature("material/08000002", {}),
		).toBe("material/08000002:missing");
	});
});
