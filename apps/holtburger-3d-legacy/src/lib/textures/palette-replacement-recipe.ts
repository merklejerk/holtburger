import type { PreparedAssetReader } from "../assets/contracts";
import { createHostAssetKey } from "../assets/keys";
import { palettePayloadDtoSchema } from "../host/contracts";
import type {
	MaterialTextureDataUseIdentity,
	PaletteIdentity,
} from "../static/contracts";
import {
	createPaletteReplacementFingerprint,
	createPaletteReplacementRecipeKey,
	type PaletteReplacementFingerprint,
	type PaletteReplacementRecipeKey,
} from "./identity";

type StaticPaletteReplacement = Extract<
	MaterialTextureDataUseIdentity,
	{ readonly kind: "prepared-palette-texture-use" }
>["replacements"][number];

export interface PaletteArgbReplacementRangeInput {
	/** Source palette label used only for diagnostics; it is not part of identity. */
	readonly paletteId: PaletteIdentity["paletteId"];
	/** Palette entry offset where the replacement range starts. */
	readonly offset: number;
	/** Number of palette entries in the replacement range. */
	readonly count: number;
	/** Full source palette ARGB colors. Only the requested range is fingerprinted. */
	readonly colorsArgb: Uint32Array | readonly number[];
}

export async function createStaticPaletteReplacementRecipeKey(input: {
	readonly assetReader: PreparedAssetReader;
	readonly replacements: readonly StaticPaletteReplacement[];
}): Promise<PaletteReplacementRecipeKey> {
	const fingerprints = await Promise.all(
		input.replacements.map(async (replacement) => {
			const palette = await input.assetReader.requestPreparedAsset(
				createHostAssetKey("palette", replacement.palette.paletteId),
			);
			const payload = palettePayloadDtoSchema.parse(palette.payload);
			return createPaletteReplacementFingerprintFromArgbColors({
				colorsArgb: payload.colorsArgb,
				count: replacement.count,
				offset: replacement.offset,
				paletteId: payload.paletteId,
			});
		}),
	);

	return createPaletteReplacementRecipeKey(fingerprints);
}

export function createPaletteReplacementFingerprintFromArgbColors(
	input: PaletteArgbReplacementRangeInput,
): PaletteReplacementFingerprint {
	if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
		throw new Error(
			`Palette replacement range offset must be a safe non-negative integer: ${input.offset}.`,
		);
	}
	if (!Number.isSafeInteger(input.count) || input.count <= 0) {
		throw new Error(
			`Palette replacement range count must be a safe positive integer: ${input.count}.`,
		);
	}
	const end = input.offset + input.count;
	if (end > input.colorsArgb.length) {
		throw new Error(
			`Palette ${formatPaletteId(input.paletteId)} replacement range ${input.offset}+${input.count} exceeds palette color count ${input.colorsArgb.length}.`,
		);
	}

	return createPaletteReplacementFingerprint({
		count: input.count,
		offset: input.offset,
		rgbaBytes: createRgbaBytesFromArgbRange(input.colorsArgb, {
			count: input.count,
			offset: input.offset,
		}),
	});
}

function createRgbaBytesFromArgbRange(
	colorsArgb: Uint32Array | readonly number[],
	range: {
		readonly offset: number;
		readonly count: number;
	},
): Uint8Array {
	const bytes = new Uint8Array(range.count * 4);
	for (let index = 0; index < range.count; index += 1) {
		const color = colorsArgb[range.offset + index];
		if (!Number.isInteger(color) || color < 0 || color > 0xffffffff) {
			throw new Error(`Palette color must be a uint32 ARGB value: ${color}.`);
		}
		const byteOffset = index * 4;
		bytes[byteOffset] = (color >> 16) & 0xff;
		bytes[byteOffset + 1] = (color >> 8) & 0xff;
		bytes[byteOffset + 2] = color & 0xff;
		bytes[byteOffset + 3] = (color >>> 24) & 0xff;
	}
	return bytes;
}

function formatPaletteId(paletteId: number): string {
	return paletteId.toString(16).padStart(8, "0");
}
