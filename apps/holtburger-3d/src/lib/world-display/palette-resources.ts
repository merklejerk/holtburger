import {
	DataTexture,
	NearestFilter,
	RGBAFormat,
	SRGBColorSpace,
	UnsignedByteType,
} from "three";

import type { PreparedPalettePayload } from "../assets/types";
import {
	argbToRgbaBytes,
	createPaletteData,
	type PaletteData,
} from "./palette-data";

export interface PaletteTextureResource {
	texture: DataTexture;
	colorCount: number;
	data: PaletteData;
}

export function createPaletteTextureResource(
	palette: PreparedPalettePayload,
	paletteAssetId = `palette/${palette.paletteId.toString(16).padStart(8, "0")}`,
): PaletteTextureResource {
	const data = createPaletteData({ paletteAssetId, palette });
	const texture = new DataTexture(
		data.colorsRgba,
		palette.colorCount,
		1,
		RGBAFormat,
		UnsignedByteType,
	);
	texture.colorSpace = SRGBColorSpace;
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return {
		texture,
		colorCount: palette.colorCount,
		data,
	};
}

export { argbToRgbaBytes };
