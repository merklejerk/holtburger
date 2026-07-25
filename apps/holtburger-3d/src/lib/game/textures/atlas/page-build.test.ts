import { describe, expect, it } from "vitest";
import {
	createAssetTextureKey,
	STATIC_OBJECT_TEXTURE_PAGE_SIZE,
	TexturePurpose,
} from "../types";
import { createAtlasPageId, type AtlasPageLayout } from "./layout";
import { buildAtlasPage } from "./page-build";

describe("buildAtlasPage", () => {
	it("materializes a complete production-size fixed page", () => {
		const key = createAssetTextureKey(
			TexturePurpose.ObjectDirectColor,
			"0x05000000",
		);
		const result = buildAtlasPage({
			page: page(TexturePurpose.ObjectDirectColor, key, 4, 4, 1, 1),
			pageSize: STATIC_OBJECT_TEXTURE_PAGE_SIZE,
			sources: [
				{ height: 1, key, pixels: Uint8Array.of(1, 2, 3, 4), width: 1 },
			],
		});

		expect(result.width).toBe(STATIC_OBJECT_TEXTURE_PAGE_SIZE);
		expect(result.height).toBe(STATIC_OBJECT_TEXTURE_PAGE_SIZE);
		expect(result.pageBits.byteLength).toBe(
			STATIC_OBJECT_TEXTURE_PAGE_SIZE ** 2 * 4,
		);
	});

	it("materializes direct-color source pixels with their repeat-safe gutter", () => {
		const key = createAssetTextureKey(
			TexturePurpose.ObjectDirectColor,
			"0x05000001",
		);
		const sourcePixels = Uint8Array.from([
			1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
		]);
		const result = buildAtlasPage({
			page: page(TexturePurpose.ObjectDirectColor, key, 4, 4, 2, 2),
			pageSize: 12,
			sources: [{ height: 2, key, pixels: sourcePixels, width: 2 }],
		});

		expect(result.copiedSourceBytes).toBe(sourcePixels.byteLength);
		expect(result.pageBits).not.toBe(sourcePixels);
		expect(pixel(result.pageBits, 12, 4, 4)).toEqual([1, 0, 0, 255]);
		expect(pixel(result.pageBits, 12, 3, 3)).toEqual([4, 0, 0, 255]);
		expect(pixel(result.pageBits, 12, 6, 6)).toEqual([1, 0, 0, 255]);
		expect(sourcePixels).toEqual(
			Uint8Array.from([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]),
		);
	});

	it("does not fabricate gutters for indexed and palette lookup pages", () => {
		const key = createAssetTextureKey(
			TexturePurpose.ObjectIndex8,
			"0x05000002",
		);
		const result = buildAtlasPage({
			page: page(TexturePurpose.ObjectIndex8, key, 2, 3, 2, 1),
			pageSize: 4,
			sources: [{ height: 1, key, pixels: Uint8Array.of(9, 8), width: 2 }],
		});

		expect([...result.pageBits.slice(14, 16)]).toEqual([9, 8]);
		expect(result.pageBits[13]).toBe(0);
	});

	it("fails before publication when page placements omit a supplied source", () => {
		const key = createAssetTextureKey(
			TexturePurpose.ObjectIndex16,
			"0x05000003",
		);
		const extraKey = createAssetTextureKey(
			TexturePurpose.ObjectIndex16,
			"0x05000004",
		);

		expect(() =>
			buildAtlasPage({
				page: page(TexturePurpose.ObjectIndex16, key, 0, 0, 1, 1),
				pageSize: 4,
				sources: [
					{ height: 1, key, pixels: Uint8Array.of(1, 2), width: 1 },
					{ height: 1, key: extraKey, pixels: Uint8Array.of(3, 4), width: 1 },
				],
			}),
		).toThrow("placements do not match");
	});
});

function page(
	purpose:
		| TexturePurpose.ObjectDirectColor
		| TexturePurpose.ObjectIndex8
		| TexturePurpose.ObjectIndex16,
	key: ReturnType<typeof createAssetTextureKey>,
	x: number,
	y: number,
	width: number,
	height: number,
): AtlasPageLayout {
	return {
		pageId: createAtlasPageId(purpose, 1),
		placements: [{ contentBounds: { height, width, x, y }, key }],
		purpose,
	};
}

function pixel(
	bits: Uint8Array,
	width: number,
	x: number,
	y: number,
): readonly number[] {
	const offset = (y * width + x) * 4;
	return [...bits.subarray(offset, offset + 4)];
}
