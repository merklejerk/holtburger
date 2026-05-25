import {
	DataTexture,
	NearestFilter,
	NoColorSpace,
	RedFormat,
	RGFormat,
	UnsignedByteType,
} from "three";

import type {
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";

export const PIXEL_FORMAT_P8 = 0x29;
export const PIXEL_FORMAT_INDEX16 = 0x65;

export type IndexedTextureFormat = "p8" | "index16";

export interface IndexedTextureResource {
	texture: DataTexture;
	format: IndexedTextureFormat;
	maxIndex: number;
}

export type IndexedPaletteSelectionSource =
	| "material-recipe"
	| "render-surface-default";

export interface IndexedPaletteSelection {
	paletteAssetId: string;
	paletteId: number;
	source: IndexedPaletteSelectionSource;
}

export function indexedTextureFormat(
	formatRaw: number,
): IndexedTextureFormat | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_P8:
			return "p8";
		case PIXEL_FORMAT_INDEX16:
			return "index16";
		default:
			return null;
	}
}

export function isIndexedTextureFormat(formatRaw: number): boolean {
	return indexedTextureFormat(formatRaw) !== null;
}

export function createIndexedTextureResource(
	renderSurface: PreparedRenderSurfacePayload,
): IndexedTextureResource {
	const format = indexedTextureFormat(renderSurface.formatRaw);
	if (!format) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} format ${renderSurface.format} is not an indexed texture format.`,
		);
	}

	assertIndexedSourceLength(renderSurface, format);
	const data =
		format === "p8"
			? copyP8IndexBytes(renderSurface.sourceBytes)
			: copyIndex16Bytes(renderSurface.sourceBytes);
	const texture = new DataTexture(
		data,
		renderSurface.width,
		renderSurface.height,
		format === "p8" ? RedFormat : RGFormat,
		UnsignedByteType,
	);
	texture.colorSpace = NoColorSpace;
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return {
		texture,
		format,
		maxIndex: scanMaxPaletteIndex(renderSurface.sourceBytes, format),
	};
}

export function selectIndexedPaletteAssetId(
	recipe: PreparedMaterialRecipePayload,
	renderSurface: PreparedRenderSurfacePayload,
): string | null {
	return selectIndexedPalette(recipe, renderSurface)?.paletteAssetId ?? null;
}

export function selectIndexedPalette(
	recipe: PreparedMaterialRecipePayload,
	renderSurface: PreparedRenderSurfacePayload,
): IndexedPaletteSelection | null {
	if (recipe.source.kind === "texture" && recipe.source.paletteId !== null) {
		return {
			paletteAssetId: formatPaletteAssetId(recipe.source.paletteId),
			paletteId: recipe.source.paletteId,
			source: "material-recipe",
		};
	}
	if (renderSurface.defaultPaletteId !== null) {
		return {
			paletteAssetId: formatPaletteAssetId(renderSurface.defaultPaletteId),
			paletteId: renderSurface.defaultPaletteId,
			source: "render-surface-default",
		};
	}
	return null;
}

export function assertIndexedSourceLength(
	renderSurface: PreparedRenderSurfacePayload,
	format: IndexedTextureFormat = indexedTextureFormat(
		renderSurface.formatRaw,
	) ?? "p8",
): void {
	const pixelCount = assertValidIndexedSurfaceDimensions(renderSurface);
	const expectedByteLength = pixelCount * indexedBytesPerPixel(format);
	if (renderSurface.sourceBytes.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} indexed source bytes, got ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
	if (renderSurface.sourceByteLength !== renderSurface.sourceBytes.byteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} declared ${renderSurface.sourceByteLength} source bytes but binary payload carried ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
}

export function scanMaxPaletteIndex(
	sourceBytes: Uint8Array,
	format: IndexedTextureFormat,
): number {
	let maxIndex = 0;
	if (format === "p8") {
		for (const index of sourceBytes) {
			maxIndex = Math.max(maxIndex, index);
		}
		return maxIndex;
	}

	for (let byteIndex = 0; byteIndex < sourceBytes.byteLength; byteIndex += 2) {
		const paletteIndex =
			(sourceBytes[byteIndex] ?? 0) | ((sourceBytes[byteIndex + 1] ?? 0) << 8);
		maxIndex = Math.max(maxIndex, paletteIndex);
	}
	return maxIndex;
}

function copyP8IndexBytes(sourceBytes: Uint8Array): Uint8Array {
	const copy = new Uint8Array(sourceBytes.byteLength);
	copy.set(sourceBytes);
	return copy;
}

function copyIndex16Bytes(sourceBytes: Uint8Array): Uint8Array {
	const copy = new Uint8Array(sourceBytes.byteLength);
	copy.set(sourceBytes);
	return copy;
}

function indexedBytesPerPixel(format: IndexedTextureFormat): number {
	return format === "p8" ? 1 : 2;
}

function assertValidIndexedSurfaceDimensions(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	if (renderSurface.width <= 0 || renderSurface.height <= 0) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} has invalid dimensions ${renderSurface.width}x${renderSurface.height}.`,
		);
	}
	const pixelCount = renderSurface.width * renderSurface.height;
	if (!Number.isSafeInteger(pixelCount)) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} dimensions are too large.`,
		);
	}
	return pixelCount;
}

function formatPaletteAssetId(paletteId: number): string {
	return `palette/${formatHex32(paletteId)}`;
}
