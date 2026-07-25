import { describe, expect, it } from "vitest";
import { packBuildingTextures } from "./building-texture-worker";
import {
	STATIC_OBJECT_TEXTURE_GUTTER_PIXELS,
	TexturePurpose,
	createAssetTextureKey,
} from "../textures/types";

describe("packBuildingTextures", () => {
	it("partitions pages by purpose and materializes a repeat-safe direct-color gutter", () => {
		const directKey = createAssetTextureKey(TexturePurpose.ObjectDirectColor, "0x05000001");
		const indexedKey = createAssetTextureKey(TexturePurpose.ObjectIndex8, "0x05000002");
		const result = packBuildingTextures({
			resourceNamespace: "static-install:test",
			pageSize: 16,
			inputs: [
				{
					height: 1,
					key: directKey,
					pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
					purpose: TexturePurpose.ObjectDirectColor,
					width: 2,
				},
				{
					height: 1,
					key: indexedKey,
					pixels: Uint8Array.from([4, 9]),
					purpose: TexturePurpose.ObjectIndex8,
					width: 2,
				},
			],
		});

		expect(result.pages).toHaveLength(2);
		const direct = result.pages.find((page) => page.purpose === TexturePurpose.ObjectDirectColor)!;
		const indexed = result.pages.find((page) => page.purpose === TexturePurpose.ObjectIndex8)!;
		expect(direct.textures[0]?.placement.preparation.gutterPixels).toBe(STATIC_OBJECT_TEXTURE_GUTTER_PIXELS);
		expect(indexed.textures[0]?.placement.preparation.gutterPixels).toBe(0);
		const placement = direct.textures[0]!.placement.bounds.min;
		const firstGutterOffset = ((placement.y * direct.width + placement.x - 1) * 4);
		expect(direct.pageBits.slice(firstGutterOffset, firstGutterOffset + 4)).toEqual(
			Uint8Array.from([5, 6, 7, 8]),
		);
	});

	it("rejects duplicate logical keys before packing", () => {
		const key = createAssetTextureKey(TexturePurpose.ObjectIndex8, "0x05000001");
		expect(() =>
			packBuildingTextures({
				resourceNamespace: "static-install:duplicate",
				inputs: [
					{ height: 1, key, pixels: Uint8Array.from([1]), purpose: TexturePurpose.ObjectIndex8, width: 1 },
					{ height: 1, key, pixels: Uint8Array.from([1]), purpose: TexturePurpose.ObjectIndex8, width: 1 },
				],
			}),
		).toThrow("duplicate logical key");
	});
});
