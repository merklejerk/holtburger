import type { DatAssetId, LandblockId } from "../game-types";

/** Logical edge behavior required by one texture use. */
export enum TextureWrapMode {
	Clamp = "clamp",
	Repeat = "repeat",
}

/** Supported gutter widths emitted by texture-page preparation. */
export type TextureGutterPixels = 0 | 4 | 8 | 16 | 64;

/** Pixel preparation facts that physically alter one packed atlas entry. */
export interface TexturePreparation {
	/** Number of prepared border pixels surrounding an atlas placement. */
	readonly gutterPixels: TextureGutterPixels;
	/** Edge behavior materialized into the generated gutter pixels. */
	readonly wrap: TextureWrapMode;
}

export enum TexturePurpose {
	TerrainColor = "terrain-color",
	TerrainBlendMask = "terrain-blend-mask",
	TerrainDetail = "terrain-detail",
	TerrainRoadMask = "terrain-road-mask",
	ObjectDirectColor = "object-direct-color",
	ObjectIndex8 = "object-index-8",
	ObjectIndex16 = "object-index-16",
	ObjectPalette = "object-palette",
	ObjectDetail = "object-detail",
}

declare const assetTextureKeyBrand: unique symbol;
declare const textureArrayKeyBrand: unique symbol;
declare const terrainSurfaceTextureKeyBrand: unique symbol;
declare const terrainCompositionTextureKeyBrand: unique symbol;

/** Logical DAT-backed two-dimensional texture; packing is a replaceable physical binding. */
export type AssetTextureKey =
	`asset-texture:${TexturePurpose}:${DatAssetId}` & {
		readonly [assetTextureKeyBrand]: true;
	};

/** Stable identity for one complete, immutable texture-array resource. */
export type TextureArrayKey = `texture-array:${TexturePurpose}:${string}` & {
	readonly [textureArrayKeyBrand]: true;
};

/** Stable generated pcode field for one landblock and mesh stride. */
export type TerrainSurfaceTextureKey =
	`terrain-surface:${LandblockId}/${number}` & {
		readonly [terrainSurfaceTextureKeyBrand]: true;
	};

/** Stable generated terrain-composition lookup table for one installed active region. */
export type TerrainCompositionTextureKey = `terrain-composition:${string}` & {
	readonly [terrainCompositionTextureKeyBrand]: true;
};

/** Stable identity for a generated two-dimensional texture resource. */
export type GeneratedTextureKey =
	| TerrainSurfaceTextureKey
	| TerrainCompositionTextureKey;

/** Logical identity for an atlas entry, asset texture, array, or generated texture. */
export type TextureKey =
	| AssetTextureKey
	| TextureArrayKey
	| GeneratedTextureKey;

/** Complete source identity for one immutable texture-array resource. */
export interface TextureArrayFact {
	readonly kind: "array";
	readonly key: TextureArrayKey;
	readonly purpose: TexturePurpose;
	readonly sourceAssetIds: readonly DatAssetId[];
}

/** Complete source identity for one DAT-backed two-dimensional logical texture. */
export interface AssetTextureFact {
	readonly kind: "asset";
	readonly key: AssetTextureKey;
	readonly purpose: TexturePurpose;
	readonly sourceAssetId: DatAssetId;
}

/** One complete logical texture resource to materialize from DAT texture sources. */
export type TextureFact = TextureArrayFact | AssetTextureFact;

export enum TexturePixelFormat {
	RGBA8 = "rgba8",
	R8 = "r8",
	RG8 = "rg8",
	A8 = "a8",
}

/** Filtering modes available to draw-time sampler policy. */
export enum TextureFilteringMode {
	Linear = "linear",
	Nearest = "nearest",
}

/** Draw-time sampling selected independently from texture resource identity. */
export interface TextureSamplerPolicy {
	/** Texel filtering required by the consuming material or draw. */
	readonly filtering: TextureFilteringMode;
	/** Hardware edge behavior required by the consuming material or draw. */
	readonly wrap: TextureWrapMode;
}

/** Device-relevant policy fixed by a texture's semantic purpose. */
export interface TexturePurposePolicy {
	/** Physical pixel format uploaded to the graphics device. */
	readonly format: TexturePixelFormat;
	/** Whether complete device resources should allocate a mip chain. */
	readonly generateMipmaps: boolean;
}

/** Build the canonical identity for one DAT-backed two-dimensional texture. */
export function createAssetTextureKey(
	purpose: TexturePurpose,
	sourceAssetId: DatAssetId,
): AssetTextureKey {
	return `asset-texture:${purpose}:${sourceAssetId}` as AssetTextureKey;
}

/** Build the canonical identity for one immutable texture-array resource. */
export function createTextureArrayKey(
	purpose: TexturePurpose,
	setId: string,
): TextureArrayKey {
	if (setId.length === 0)
		throw new Error("Texture array set id cannot be empty.");
	return `texture-array:${purpose}:${setId}` as TextureArrayKey;
}

/** Build the canonical generated pcode-field identity for one landblock mesh stride. */
export function createTerrainSurfaceTextureKey(
	landblockId: LandblockId,
	stride: number,
): TerrainSurfaceTextureKey {
	if (!Number.isInteger(stride) || stride <= 0) {
		throw new Error(
			"Terrain surface texture stride must be a positive integer.",
		);
	}
	return `terrain-surface:${landblockId}/${stride}` as TerrainSurfaceTextureKey;
}

/** Build the canonical generated terrain-composition identity for one installed active region. */
export function createTerrainCompositionTextureKey(
	activeRegionKey: string,
): TerrainCompositionTextureKey {
	if (activeRegionKey.length === 0) {
		throw new Error(
			"Terrain composition texture active-region key cannot be empty.",
		);
	}
	return `terrain-composition:${activeRegionKey}` as TerrainCompositionTextureKey;
}

/** Narrow a logical texture identity to a complete array resource. */
export function isTextureArrayKey(key: TextureKey): key is TextureArrayKey {
	return key.startsWith("texture-array:");
}

/** Narrow a logical texture identity to one DAT-backed two-dimensional texture. */
export function isAssetTextureKey(key: TextureKey): key is AssetTextureKey {
	return key.startsWith("asset-texture:");
}

/** Narrow a logical texture identity to one generated two-dimensional texture. */
export function isGeneratedTextureKey(
	key: TextureKey,
): key is GeneratedTextureKey {
	return (
		key.startsWith("terrain-surface:") || key.startsWith("terrain-composition:")
	);
}

/** Test whether an asset key matches its immutable source facts. */
export function assetTextureKeyMatchesSource(
	key: AssetTextureKey,
	purpose: TexturePurpose,
	sourceAssetId: DatAssetId,
): boolean {
	return key === createAssetTextureKey(purpose, sourceAssetId);
}

/** Test whether an array key belongs to one semantic texture purpose. */
export function textureArrayKeyMatchesPurpose(
	key: TextureArrayKey,
	purpose: TexturePurpose,
): boolean {
	return key.startsWith(`texture-array:${purpose}:`);
}

/** Return the one device policy admitted by a semantic texture purpose. */
export function texturePurposePolicy(
	purpose: TexturePurpose,
): TexturePurposePolicy {
	switch (purpose) {
		case TexturePurpose.TerrainColor:
		case TexturePurpose.TerrainDetail:
		case TexturePurpose.ObjectDetail:
			return {
				format: TexturePixelFormat.RGBA8,
				generateMipmaps: true,
			};
		case TexturePurpose.ObjectDirectColor:
			// Packed object pages begin at level zero only until per-entry mip isolation exists.
			return {
				format: TexturePixelFormat.RGBA8,
				generateMipmaps: false,
			};
		case TexturePurpose.TerrainBlendMask:
		case TexturePurpose.TerrainRoadMask:
			return {
				format: TexturePixelFormat.R8,
				generateMipmaps: false,
			};
		case TexturePurpose.ObjectIndex8:
			return {
				format: TexturePixelFormat.R8,
				generateMipmaps: false,
			};
		case TexturePurpose.ObjectIndex16:
			return {
				format: TexturePixelFormat.RG8,
				generateMipmaps: false,
			};
		case TexturePurpose.ObjectPalette:
			return {
				format: TexturePixelFormat.RGBA8,
				generateMipmaps: false,
			};
	}
}
