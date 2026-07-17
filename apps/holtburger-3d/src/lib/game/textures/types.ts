import type { DatAssetId } from "../game-types";

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

declare const textureAtlasEntryKeyBrand: unique symbol;
declare const standaloneTextureKeyBrand: unique symbol;
declare const textureArrayKeyBrand: unique symbol;

/** Stable identity for one prepared DAT texture placed inside an atlas page. */
export type TextureAtlasEntryKey =
	`atlas-entry:${TexturePurpose}:${DatAssetId}/${TextureWrapMode}-gutter-${TextureGutterPixels}` & {
		readonly [textureAtlasEntryKeyBrand]: true;
	};

/** Stable identity for one complete, unpacked two-dimensional texture. */
export type StandaloneTextureKey =
	`standalone-texture:${TexturePurpose}:${DatAssetId}` & {
		readonly [standaloneTextureKeyBrand]: true;
	};

/** Stable identity for one complete, immutable texture-array resource. */
export type TextureArrayKey = `texture-array:${TexturePurpose}:${string}` & {
	readonly [textureArrayKeyBrand]: true;
};

/** Logical identity for an atlas entry, standalone texture, or texture array. */
export type TextureKey =
	| TextureAtlasEntryKey
	| StandaloneTextureKey
	| TextureArrayKey;

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

/** Build the canonical identity for one prepared texture use. */
export function createAtlasEntryKey(
	purpose: TexturePurpose,
	sourceAssetId: DatAssetId,
	preparation: TexturePreparation,
): TextureAtlasEntryKey {
	return `atlas-entry:${purpose}:${sourceAssetId}/${preparation.wrap}-gutter-${preparation.gutterPixels}` as TextureAtlasEntryKey;
}

/** Build the canonical identity for one complete unpacked DAT texture. */
export function createStandaloneTextureKey(
	purpose: TexturePurpose,
	sourceAssetId: DatAssetId,
): StandaloneTextureKey {
	return `standalone-texture:${purpose}:${sourceAssetId}` as StandaloneTextureKey;
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

/** Narrow a logical texture identity to a complete array resource. */
export function isTextureArrayKey(key: TextureKey): key is TextureArrayKey {
	return key.startsWith("texture-array:");
}

/** Narrow a logical texture identity to one complete unpacked texture. */
export function isStandaloneTextureKey(
	key: TextureKey,
): key is StandaloneTextureKey {
	return key.startsWith("standalone-texture:");
}

/** Test whether a standalone key matches its immutable source facts. */
export function standaloneTextureKeyMatchesSource(
	key: StandaloneTextureKey,
	purpose: TexturePurpose,
	sourceAssetId: DatAssetId,
): boolean {
	return key === createStandaloneTextureKey(purpose, sourceAssetId);
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
		case TexturePurpose.ObjectDirectColor:
		case TexturePurpose.ObjectDetail:
			return {
				format: TexturePixelFormat.RGBA8,
				generateMipmaps: true,
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
