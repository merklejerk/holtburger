import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	deriveLegacyMaterialBehaviorDto,
	type LegacyMaterialBehaviorDto,
} from "./material-behavior";
import {
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import { resolveFirstMaterialRenderSurface } from "./material-texture-resolution";
import {
	createDerivedPaletteData,
	createPaletteData,
	formatPaletteAssetId,
	type DerivedPaletteData,
	type PaletteData,
	type PaletteDataDiagnosticHandler,
} from "./palette-data";
import type { TextureSamplingPolicy } from "./texture-pages/texture-sampling-policy";

export const PIXEL_FORMAT_P8 = 0x29;
export const PIXEL_FORMAT_INDEX16 = 0x65;

export type IndexedTextureFormat = "p8" | "index16";
type IndexedPaletteSelectionSource =
	| "appearance-override"
	| "material-recipe"
	| "render-surface-default";

export interface IndexedPaletteSelection {
	paletteAssetId: string;
	paletteId: number;
	source: IndexedPaletteSelectionSource;
}

export interface IndexedTextureData {
	renderSurfaceAssetId: string;
	renderSurfaceId: number;
	width: number;
	height: number;
	format: IndexedTextureFormat;
	sourceBytes: Uint8Array;
	maxIndex: number;
}

export type NeighborPackedIndexedPayload =
	| {
			format: "p8-neighbor-rgba8";
			indexFormat: "p8";
			width: number;
			height: number;
			componentsPerPixel: 4;
			data: Uint8Array;
	  }
	| {
			format: "index16-neighbor-rgba16ui";
			indexFormat: "index16";
			width: number;
			height: number;
			componentsPerPixel: 4;
			data: Uint16Array;
	  };

export interface ResolvedIndexedMaterialData {
	materialAssetId: string;
	slot: ResolvedMaterialSlot;
	recipe: PreparedMaterialRecipePayload;
	renderSurfaceAssetId: string;
	renderSurface: PreparedRenderSurfacePayload;
	texture: IndexedTextureData;
	neighborPackedTexture: NeighborPackedIndexedPayload;
	paletteSelection: IndexedPaletteSelection;
	palette: PaletteData | DerivedPaletteData;
	samplingPolicy: TextureSamplingPolicy;
	behavior: LegacyMaterialBehaviorDto;
	preparedAssetIds: readonly string[];
}

export interface IndexedMaterialDataCache {
	get(key: string): ResolvedIndexedMaterialData | undefined;
	set(key: string, value: ResolvedIndexedMaterialData): void;
	clear(): void;
}

interface IndexedMaterialDataDiagnostic {
	key: string;
	message: string;
	detail: Record<string, unknown>;
}

export type IndexedMaterialDataDiagnosticHandler = (
	diagnostic: IndexedMaterialDataDiagnostic,
) => void;

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

export function createIndexedTextureData(
	renderSurface: PreparedRenderSurfacePayload,
): IndexedTextureData {
	const format = indexedTextureFormat(renderSurface.formatRaw);
	if (!format) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} format ${renderSurface.format} is not an indexed texture format.`,
		);
	}
	assertIndexedSourceLength(renderSurface, format);
	return {
		renderSurfaceAssetId: formatRenderSurfaceAssetId(
			renderSurface.renderSurfaceId,
		),
		renderSurfaceId: renderSurface.renderSurfaceId,
		width: renderSurface.width,
		height: renderSurface.height,
		format,
		sourceBytes: copyIndexedSourceBytes(renderSurface.sourceBytes),
		maxIndex: scanMaxPaletteIndex(renderSurface.sourceBytes, format),
	};
}

export function createNeighborPackedIndexedPayload(options: {
	texture: IndexedTextureData;
	wrapS: TextureSamplingPolicy["wrapS"];
	wrapT: TextureSamplingPolicy["wrapT"];
}): NeighborPackedIndexedPayload {
	if (options.texture.format === "p8") {
		return {
			format: "p8-neighbor-rgba8",
			indexFormat: "p8",
			width: options.texture.width,
			height: options.texture.height,
			componentsPerPixel: 4,
			data: packNeighborIndices(options, readP8Index),
		};
	}
	return {
		format: "index16-neighbor-rgba16ui",
		indexFormat: "index16",
		width: options.texture.width,
		height: options.texture.height,
		componentsPerPixel: 4,
		data: packNeighborIndices(options, readIndex16),
	};
}

export function selectIndexedPalette(options: {
	recipe: PreparedMaterialRecipePayload;
	renderSurface: PreparedRenderSurfacePayload;
	appearance?: MaterialAppearanceContext | null;
}): IndexedPaletteSelection | null {
	const appearancePaletteId = options.appearance?.paletteView?.paletteId;
	if (appearancePaletteId !== null && appearancePaletteId !== undefined) {
		return {
			paletteAssetId: formatPaletteAssetId(appearancePaletteId),
			paletteId: appearancePaletteId,
			source: "appearance-override",
		};
	}
	if (
		options.recipe.source.kind === "texture" &&
		options.recipe.source.paletteId !== null
	) {
		return {
			paletteAssetId: formatPaletteAssetId(options.recipe.source.paletteId),
			paletteId: options.recipe.source.paletteId,
			source: "material-recipe",
		};
	}
	if (options.renderSurface.defaultPaletteId !== null) {
		return {
			paletteAssetId: formatPaletteAssetId(
				options.renderSurface.defaultPaletteId,
			),
			paletteId: options.renderSurface.defaultPaletteId,
			source: "render-surface-default",
		};
	}
	return null;
}

export function resolveIndexedMaterialData(options: {
	assetState: AssetChannelState;
	slot: ResolvedMaterialSlot;
	appearance: MaterialAppearanceContext;
	samplingPolicy: TextureSamplingPolicy;
	cache?: IndexedMaterialDataCache;
	reportDiagnostic?: IndexedMaterialDataDiagnosticHandler;
}): ResolvedIndexedMaterialData | null {
	const recipeAsset =
		options.assetState.preparedByAssetId[options.slot.materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		options.reportDiagnostic?.({
			key: `indexed-material-missing-recipe:${options.slot.materialAssetId}`,
			message: `Cannot resolve indexed material because ${options.slot.materialAssetId} is not prepared as a material recipe.`,
			detail: {
				materialAssetId: options.slot.materialAssetId,
				preparedKind: recipeAsset?.payload.kind ?? null,
			},
		});
		return null;
	}
	const recipe = recipeAsset.payload;
	const resolvedSurface = resolveFirstMaterialRenderSurface({
		recipe,
		assetState: options.assetState,
	});
	if (!resolvedSurface) {
		options.reportDiagnostic?.({
			key: `indexed-material-missing-render-surface:${options.slot.materialAssetId}`,
			message: `Cannot resolve indexed material because no render surface is prepared.`,
			detail: {
				materialAssetId: options.slot.materialAssetId,
				renderSurfaceAssetIds: recipe.dependencies.renderSurfaceAssetIds,
			},
		});
		return null;
	}
	if (!isIndexedTextureFormat(resolvedSurface.renderSurface.formatRaw)) {
		return null;
	}

	const paletteSelection = selectIndexedPalette({
		recipe,
		renderSurface: resolvedSurface.renderSurface,
		appearance: options.appearance,
	});
	if (!paletteSelection) {
		options.reportDiagnostic?.({
			key: `indexed-material-palette-missing:${options.slot.materialAssetId}:${resolvedSurface.assetId}`,
			message: `Cannot resolve indexed material because ${resolvedSurface.assetId} has no palette selection.`,
			detail: {
				materialAssetId: options.slot.materialAssetId,
				renderSurfaceAssetId: resolvedSurface.assetId,
				defaultPaletteId: resolvedSurface.renderSurface.defaultPaletteId,
				recipePaletteId:
					recipe.source.kind === "texture" ? recipe.source.paletteId : null,
			},
		});
		return null;
	}

	const paletteAsset =
		options.assetState.preparedByAssetId[paletteSelection.paletteAssetId];
	if (paletteAsset?.payload.kind !== "palette") {
		options.reportDiagnostic?.({
			key: `indexed-material-palette-unprepared:${options.slot.materialAssetId}:${resolvedSurface.assetId}:${paletteSelection.paletteAssetId}`,
			message: `Cannot resolve indexed material because ${paletteSelection.paletteAssetId} is not prepared.`,
			detail: {
				materialAssetId: options.slot.materialAssetId,
				renderSurfaceAssetId: resolvedSurface.assetId,
				paletteAssetId: paletteSelection.paletteAssetId,
				paletteSource: paletteSelection.source,
				preparedKind: paletteAsset?.payload.kind ?? null,
			},
		});
		return null;
	}
	const palette = resolvePaletteData({
		basePaletteAssetId: paletteSelection.paletteAssetId,
		basePaletteAsset: paletteAsset,
		appearance: options.appearance,
		preparedByAssetId: options.assetState.preparedByAssetId,
		reportDiagnostic: (diagnostic) => options.reportDiagnostic?.(diagnostic),
	});
	if (!palette) {
		return null;
	}
	const cacheKey = describeIndexedMaterialDataCacheKey({
		materialAssetId: options.slot.materialAssetId,
		materialAsset: recipeAsset,
		renderSurfaceAssetId: resolvedSurface.assetId,
		renderSurfaceAsset:
			options.assetState.preparedByAssetId[resolvedSurface.assetId],
		palette,
		paletteAsset,
		appearance: options.appearance,
		samplingPolicy: options.samplingPolicy,
	});
	const cached = options.cache?.get(cacheKey);
	if (cached) {
		return cached;
	}
	const texture = createIndexedTextureData(resolvedSurface.renderSurface);
	if (texture.maxIndex >= palette.colorCount) {
		options.reportDiagnostic?.({
			key: `indexed-material-index-out-of-range:${options.slot.materialAssetId}:${resolvedSurface.assetId}:${paletteSelection.paletteAssetId}`,
			message: `Cannot resolve indexed material because ${resolvedSurface.assetId} references palette index ${texture.maxIndex}, but ${paletteSelection.paletteAssetId} has ${palette.colorCount} colors.`,
			detail: {
				materialAssetId: options.slot.materialAssetId,
				renderSurfaceAssetId: resolvedSurface.assetId,
				paletteAssetId: paletteSelection.paletteAssetId,
				paletteSource: paletteSelection.source,
				maxIndex: texture.maxIndex,
				colorCount: palette.colorCount,
			},
		});
		return null;
	}

	const preparedAssetIds = new Set<string>([
		options.slot.materialAssetId,
		resolvedSurface.assetId,
		paletteSelection.paletteAssetId,
	]);
	for (const subPalette of options.appearance.paletteView?.subPalettes ?? []) {
		preparedAssetIds.add(formatPaletteAssetId(subPalette.subId));
	}
	const resolved = {
		materialAssetId: options.slot.materialAssetId,
		slot: options.slot,
		recipe,
		renderSurfaceAssetId: resolvedSurface.assetId,
		renderSurface: resolvedSurface.renderSurface,
		texture,
		neighborPackedTexture: createNeighborPackedIndexedPayload({
			texture,
			wrapS: options.samplingPolicy.wrapS,
			wrapT: options.samplingPolicy.wrapT,
		}),
		paletteSelection,
		palette,
		samplingPolicy: options.samplingPolicy,
		behavior: deriveLegacyMaterialBehaviorDto({
			recipe,
			usesIndexedClipDiscard: true,
		}),
		preparedAssetIds: [...preparedAssetIds].sort(),
	} satisfies ResolvedIndexedMaterialData;
	options.cache?.set(cacheKey, resolved);
	return resolved;
}

function describeIndexedMaterialDataCacheKey(options: {
	materialAssetId: string;
	materialAsset: PreparedAssetRecord;
	renderSurfaceAssetId: string;
	renderSurfaceAsset: PreparedAssetRecord | undefined;
	palette: PaletteData | DerivedPaletteData;
	paletteAsset: PreparedAssetRecord;
	appearance: MaterialAppearanceContext;
	samplingPolicy: TextureSamplingPolicy;
}): string {
	return [
		options.materialAssetId,
		describePreparedAssetState(options.materialAsset),
		options.renderSurfaceAssetId,
		describePreparedAssetState(options.renderSurfaceAsset),
		describeResolvedPaletteCacheKey(options.palette, options.paletteAsset),
		describeMaterialAppearanceSignature(options.appearance),
		describeIndexedSamplingCacheKey(options.samplingPolicy),
	].join("|");
}

function describeResolvedPaletteCacheKey(
	palette: PaletteData | DerivedPaletteData,
	paletteAsset: PreparedAssetRecord,
): string {
	if ("key" in palette) {
		return palette.key;
	}
	return [
		palette.paletteAssetId,
		describePreparedAssetState(paletteAsset),
		palette.paletteId,
		palette.colorCount,
	].join(":");
}

function describeIndexedSamplingCacheKey(
	samplingPolicy: TextureSamplingPolicy,
): string {
	return [
		`wrapS=${samplingPolicy.wrapS}`,
		`wrapT=${samplingPolicy.wrapT}`,
		`min=${samplingPolicy.minFilter}`,
		`mag=${samplingPolicy.magFilter}`,
		`mip=${samplingPolicy.mipFilter}`,
		`mips=${samplingPolicy.generateMipmaps ? "on" : "off"}`,
		`aniso=${samplingPolicy.anisotropy}`,
	].join(":");
}

function describePreparedAssetState(
	asset: PreparedAssetRecord | undefined,
): string {
	if (!asset) {
		return "missing";
	}
	return [
		asset.payload.kind,
		asset.preparedAt,
		asset.payload.provenance.errorCode ?? "ok",
	].join(":");
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

function resolvePaletteData(options: {
	basePaletteAssetId: string;
	basePaletteAsset: PreparedAssetRecord;
	appearance: MaterialAppearanceContext;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	reportDiagnostic: PaletteDataDiagnosticHandler;
}): PaletteData | DerivedPaletteData | null {
	if (options.basePaletteAsset.payload.kind !== "palette") {
		throw new Error(
			`Indexed palette ${options.basePaletteAssetId} was resolved with non-palette payload ${options.basePaletteAsset.payload.kind}.`,
		);
	}
	if (!options.appearance.paletteView?.subPalettes.length) {
		return createPaletteData({
			paletteAssetId: options.basePaletteAssetId,
			palette: options.basePaletteAsset.payload,
		});
	}
	return createDerivedPaletteData({
		basePaletteAssetId: options.basePaletteAssetId,
		basePalette: options.basePaletteAsset.payload,
		paletteView: options.appearance.paletteView,
		preparedByAssetId: options.preparedByAssetId,
		reportDiagnostic: options.reportDiagnostic,
	});
}

function assertIndexedSourceLength(
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

function packNeighborIndices<TArray extends Uint8Array | Uint16Array>(
	options: {
		texture: IndexedTextureData;
		wrapS: TextureSamplingPolicy["wrapS"];
		wrapT: TextureSamplingPolicy["wrapT"];
	},
	readIndex: (texture: IndexedTextureData, x: number, y: number) => number,
): TArray {
	const pixelCount = options.texture.width * options.texture.height;
	const packed =
		options.texture.format === "p8"
			? new Uint8Array(pixelCount * 4)
			: new Uint16Array(pixelCount * 4);
	for (let y = 0; y < options.texture.height; y += 1) {
		for (let x = 0; x < options.texture.width; x += 1) {
			const offset = (y * options.texture.width + x) * 4;
			const rightX = resolveNeighborCoord(
				x + 1,
				options.texture.width,
				options.wrapS,
			);
			const downY = resolveNeighborCoord(
				y + 1,
				options.texture.height,
				options.wrapT,
			);
			packed[offset] = readIndex(options.texture, x, y);
			packed[offset + 1] = readIndex(options.texture, rightX, y);
			packed[offset + 2] = readIndex(options.texture, x, downY);
			packed[offset + 3] = readIndex(options.texture, rightX, downY);
		}
	}
	return packed as TArray;
}

function readP8Index(
	texture: IndexedTextureData,
	x: number,
	y: number,
): number {
	return texture.sourceBytes[y * texture.width + x] ?? 0;
}

function readIndex16(
	texture: IndexedTextureData,
	x: number,
	y: number,
): number {
	const byteOffset = (y * texture.width + x) * 2;
	return (
		(texture.sourceBytes[byteOffset] ?? 0) |
		((texture.sourceBytes[byteOffset + 1] ?? 0) << 8)
	);
}

function resolveNeighborCoord(
	value: number,
	size: number,
	wrap: TextureSamplingPolicy["wrapS"] | TextureSamplingPolicy["wrapT"],
): number {
	if (value < size) {
		return value;
	}
	return wrap === "repeat" ? 0 : size - 1;
}

function copyIndexedSourceBytes(sourceBytes: Uint8Array): Uint8Array {
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

function formatRenderSurfaceAssetId(renderSurfaceId: number): string {
	return `render-surface/${formatHex32(renderSurfaceId)}`;
}
