import { describe, expect, it } from "vitest";
import type { HostAssetKey, PreparedAssetReader } from "../assets/contracts";
import { describeHostAssetKey } from "../assets/keys";
import type { PreparedAsset } from "../assets/contracts";
import {
	createPaletteReplacementFingerprintFromArgbColors,
	createStaticPaletteReplacementRecipeKey,
} from "./palette-replacement-recipe";

describe("palette replacement recipe identity", () => {
	it("uses replacement range bytes instead of replacement palette ids", async () => {
		const firstReader = createPaletteReader([
			createPaletteAsset(
				0x04000010,
				[0xff000000, 0xff112233, 0xff445566, 0xffffffff],
			),
		]);
		const secondReader = createPaletteReader([
			createPaletteAsset(
				0x04000020,
				[0xff999999, 0xff112233, 0xff445566, 0xff000000],
			),
		]);

		const firstRecipe = await createStaticPaletteReplacementRecipeKey({
			assetReader: firstReader,
			replacements: [createReplacement(0x04000010, 1, 2)],
		});
		const secondRecipe = await createStaticPaletteReplacementRecipeKey({
			assetReader: secondReader,
			replacements: [createReplacement(0x04000020, 1, 2)],
		});

		expect(firstRecipe).toBe(secondRecipe);
		expect(firstReader.requestedKeys).toEqual(["palette:04000010"]);
		expect(secondReader.requestedKeys).toEqual(["palette:04000020"]);
	});

	it("changes recipe identity when the replacement bytes change", async () => {
		const firstRecipe = await createStaticPaletteReplacementRecipeKey({
			assetReader: createPaletteReader([
				createPaletteAsset(
					0x04000010,
					[0xff000000, 0xff112233, 0xff445566, 0xffffffff],
				),
			]),
			replacements: [createReplacement(0x04000010, 1, 2)],
		});
		const secondRecipe = await createStaticPaletteReplacementRecipeKey({
			assetReader: createPaletteReader([
				createPaletteAsset(
					0x04000010,
					[0xff000000, 0xff112233, 0xff445567, 0xffffffff],
				),
			]),
			replacements: [createReplacement(0x04000010, 1, 2)],
		});

		expect(secondRecipe).not.toBe(firstRecipe);
	});

	it("matches runtime-authored replacement bytes with static ARGB palette ranges", () => {
		const staticRange = createPaletteReplacementFingerprintFromArgbColors({
			colorsArgb: [0xff000000, 0xff112233],
			count: 1,
			offset: 1,
			paletteId: 0x04000010,
		});
		const runtimeRange = createPaletteReplacementFingerprintFromArgbColors({
			colorsArgb: [0xff999999, 0xff112233],
			count: 1,
			offset: 1,
			paletteId: 0x0400ffff,
		});

		expect(runtimeRange).toEqual(staticRange);
	});

	it("rejects ranges that cannot be resolved from palette bytes", () => {
		expect(() =>
			createPaletteReplacementFingerprintFromArgbColors({
				colorsArgb: [0xff000000],
				count: 2,
				offset: 0,
				paletteId: 0x04000010,
			}),
		).toThrow("exceeds palette color count");
	});
});

interface RecordingPaletteReader extends PreparedAssetReader {
	readonly requestedKeys: readonly string[];
}

function createPaletteReader(
	assets: readonly PreparedAsset[],
): RecordingPaletteReader {
	const assetsByKey = new Map(
		assets.map((asset) => [describeHostAssetKey(asset.key), asset] as const),
	);
	const requestedKeys: string[] = [];
	return {
		requestedKeys,
		async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
			requestedKeys.push(describeHostAssetKey(key));
			const asset = assetsByKey.get(describeHostAssetKey(key));
			if (!asset) {
				throw new Error(`Missing fixture asset ${describeHostAssetKey(key)}.`);
			}
			return asset;
		},
	};
}

function createReplacement(paletteId: number, offset: number, count: number) {
	return {
		count,
		offset,
		palette: {
			kind: "palette" as const,
			paletteId,
		},
	};
}

function createPaletteAsset(
	paletteId: number,
	colorsArgb: readonly number[],
): PreparedAsset {
	return {
		key: {
			id: paletteId.toString(16).padStart(8, "0"),
			kind: "palette",
		},
		payload: {
			colorCount: colorsArgb.length,
			colorsArgb,
			kind: "palette",
			paletteId,
			provenance: {
				detail: null,
				errorCode: null,
				source: "app-local-stub",
				sourceAssetKind: "palette",
			},
			residencyKind: "unknown",
			sourceAssetKind: "palette",
		},
		preparedAt: "fixture",
		revision: 1,
		sourceAssetId: `palette/${paletteId.toString(16).padStart(8, "0")}`,
	};
}
