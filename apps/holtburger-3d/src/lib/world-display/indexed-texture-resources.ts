import { DataTexture, RedFormat, RGFormat, UnsignedByteType } from "three";

import type {
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import {
	PIXEL_FORMAT_INDEX16,
	PIXEL_FORMAT_P8,
	createIndexedTextureData,
	indexedTextureFormat,
	isIndexedTextureFormat,
	scanMaxPaletteIndex,
	selectIndexedPalette as selectIndexedPaletteData,
	type IndexedPaletteSelection,
	type IndexedTextureFormat,
} from "./indexed-material-data";
import {
	applyTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-sampling-policy";

export interface IndexedTextureResource {
	texture: DataTexture;
	format: IndexedTextureFormat;
	maxIndex: number;
}

export function createIndexedTextureResource(
	renderSurface: PreparedRenderSurfacePayload,
	samplingPolicy: TextureSamplingPolicy,
): IndexedTextureResource {
	const data = createIndexedTextureData(renderSurface);
	const texture = new DataTexture(
		data.sourceBytes,
		renderSurface.width,
		renderSurface.height,
		data.format === "p8" ? RedFormat : RGFormat,
		UnsignedByteType,
	);
	applyTextureSamplingPolicy(texture, samplingPolicy);
	texture.needsUpdate = true;
	return {
		texture,
		format: data.format,
		maxIndex: data.maxIndex,
	};
}

export function selectIndexedPalette(
	recipe: PreparedMaterialRecipePayload,
	renderSurface: PreparedRenderSurfacePayload,
): IndexedPaletteSelection | null {
	return selectIndexedPaletteData({ recipe, renderSurface });
}

export {
	PIXEL_FORMAT_INDEX16,
	PIXEL_FORMAT_P8,
	indexedTextureFormat,
	isIndexedTextureFormat,
	scanMaxPaletteIndex,
};
export type { IndexedPaletteSelection, IndexedTextureFormat };
