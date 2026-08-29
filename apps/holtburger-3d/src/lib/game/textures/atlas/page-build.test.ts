import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";
import {
	createAssetTextureKey,
	packedObjectTexturePreparation,
	TexturePurpose,
} from "../types";
import { createAtlasPageId, type AtlasPageLayout } from "./layout";
import { buildAtlasPage, buildAtlasPagePatch } from "./page-build";

describe("buildAtlasPage", () => {
	it("materializes a complete production-size fixed page", () => {
		const gutterPixels = packedObjectTexturePreparation(
			TexturePurpose.ObjectDirectColor,
		).gutterPixels;
		const key = createAssetTextureKey(
			TexturePurpose.ObjectDirectColor,
			"0x05000000",
		);
		const result = buildAtlasPage({
			page: page(
				TexturePurpose.ObjectDirectColor,
				key,
				gutterPixels,
				gutterPixels,
				1,
				1,
			),
			pageSize:
				SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize,
			sources: [
				{ height: 1, key, pixels: Uint8Array.of(1, 2, 3, 4), width: 1 },
			],
		});

		expect(result.width).toBe(
			SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize,
		);
		expect(result.height).toBe(
			SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize,
		);
		expect(result.pageBits.byteLength).toBe(
			SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize ** 2 *
				4,
		);
	});

	it("materializes direct-color source pixels with their repeat-safe gutter", () => {
		const gutterPixels = packedObjectTexturePreparation(
			TexturePurpose.ObjectDirectColor,
		).gutterPixels;
		const sourceSize = 2;
		const pageSize = sourceSize + gutterPixels * 2;
		const key = createAssetTextureKey(
			TexturePurpose.ObjectDirectColor,
			"0x05000001",
		);
		const sourcePixels = Uint8Array.from([
			1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
		]);
		const result = buildAtlasPage({
			page: page(
				TexturePurpose.ObjectDirectColor,
				key,
				gutterPixels,
				gutterPixels,
				sourceSize,
				sourceSize,
			),
			pageSize,
			sources: [
				{ height: sourceSize, key, pixels: sourcePixels, width: sourceSize },
			],
		});

		expect(result.copiedSourceBytes).toBe(sourcePixels.byteLength);
		expect(result.pageBits).not.toBe(sourcePixels);
		expect(
			pixel(result.pageBits, pageSize, gutterPixels, gutterPixels),
		).toEqual([1, 0, 0, 255]);
		expect(
			pixel(result.pageBits, pageSize, gutterPixels - 1, gutterPixels - 1),
		).toEqual([4, 0, 0, 255]);
		expect(
			pixel(result.pageBits, pageSize, pageSize - 1, pageSize - 1),
		).toEqual([4, 0, 0, 255]);
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

describe("buildAtlasPagePatch", () => {
	const purpose = TexturePurpose.ObjectDirectColor;
	const gutterPixels = packedObjectTexturePreparation(purpose).gutterPixels;
	const pageSize = 64;
	const first = createAssetTextureKey(purpose, "0x05000010");
	const second = createAssetTextureKey(purpose, "0x05000011");
	const sources = [
		{ height: 1, key: first, pixels: Uint8Array.of(11, 12, 13, 14), width: 1 },
		{ height: 1, key: second, pixels: Uint8Array.of(21, 22, 23, 24), width: 1 },
	];
	const fullPage: AtlasPageLayout = {
		pageId: createAtlasPageId(purpose, 1),
		placements: [
			{
				contentBounds: {
					height: 1,
					width: 1,
					x: gutterPixels,
					y: gutterPixels,
				},
				key: first,
			},
			{
				contentBounds: {
					height: 1,
					width: 1,
					x: gutterPixels * 3 + 1,
					y: gutterPixels,
				},
				key: second,
			},
		],
		purpose,
	};

	it("patches a published page into the exact bits of a whole-page build", () => {
		const published = buildAtlasPage({
			page: {
				...fullPage,
				placements: fullPage.placements.filter(({ key }) => key === first),
			},
			pageSize,
			sources: sources.filter(({ key }) => key === first),
		});
		const rebuilt = buildAtlasPage({ page: fullPage, pageSize, sources });
		const patch = buildAtlasPagePatch({
			page: fullPage,
			pageSize,
			patchedKeys: [second],
			sources: sources.filter(({ key }) => key === second),
		});

		const patchedBits = Uint8Array.from(published.pageBits);
		for (const region of patch.regions) {
			for (let row = 0; row < region.height; row += 1) {
				patchedBits.set(
					region.data.subarray(
						row * region.width * 4,
						(row + 1) * region.width * 4,
					),
					((region.y + row) * pageSize + region.x) * 4,
				);
			}
		}
		expect(patchedBits).toEqual(rebuilt.pageBits);
	});

	it("covers the placement's whole gutter ring so no stale texel survives", () => {
		const patch = buildAtlasPagePatch({
			page: fullPage,
			pageSize,
			patchedKeys: [second],
			sources: sources.filter(({ key }) => key === second),
		});

		expect(patch.regions).toHaveLength(1);
		expect(patch.regions[0]).toMatchObject({
			height: 1 + gutterPixels * 2,
			width: 1 + gutterPixels * 2,
			x: gutterPixels * 3 + 1 - gutterPixels,
			y: 0,
		});
	});

	it("rejects a patch key the planned page does not place", () => {
		expect(() =>
			buildAtlasPagePatch({
				page: {
					...fullPage,
					placements: fullPage.placements.filter(({ key }) => key === first),
				},
				pageSize,
				patchedKeys: [second],
				sources: sources.filter(({ key }) => key === second),
			}),
		).toThrow("is not a planned placement");
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
