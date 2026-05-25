import {
	DataTexture,
	NearestFilter,
	RGBAFormat,
	SRGBColorSpace,
	UnsignedByteType,
} from "three";

import type { PreparedPalettePayload } from "../assets/types";

const RGBA_COMPONENT_COUNT = 4;

export interface PaletteTextureResource {
	texture: DataTexture;
	colorCount: number;
}

export function createPaletteTextureResource(
	palette: PreparedPalettePayload,
): PaletteTextureResource {
	const colorsRgba = argbToRgbaBytes(palette.colorsArgb);
	const texture = new DataTexture(
		colorsRgba,
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
	};
}

export function argbToRgbaBytes(colorsArgb: Uint32Array): Uint8Array {
	if (colorsArgb.length === 0) {
		throw new Error("Palette textures require at least one color.");
	}

	const colorsRgba = new Uint8Array(colorsArgb.length * RGBA_COMPONENT_COUNT);
	for (let index = 0; index < colorsArgb.length; index += 1) {
		const argb = colorsArgb[index] as number;
		const offset = index * RGBA_COMPONENT_COUNT;
		colorsRgba[offset] = (argb >>> 16) & 0xff;
		colorsRgba[offset + 1] = (argb >>> 8) & 0xff;
		colorsRgba[offset + 2] = argb & 0xff;
		colorsRgba[offset + 3] = (argb >>> 24) & 0xff;
	}
	return colorsRgba;
}
