import type {
	DatAssetId,
	LandblockOwnerId,
	PaletteComposite,
	TextureSourceId,
} from "../game-types";

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

/** Evidence-backed filterable gutter for packed static-object direct-color textures. */
const STATIC_OBJECT_TEXTURE_GUTTER_PIXELS: TextureGutterPixels = 8;

/** Texture purposes admitted by the runtime static-object atlas. */
export type PackedObjectTexturePurpose =
	| TexturePurpose.ObjectDirectColor
	| TexturePurpose.ObjectIndex8
	| TexturePurpose.ObjectIndex16
	| TexturePurpose.ObjectPalette;

declare const assetTextureKeyBrand: unique symbol;
declare const textureArrayKeyBrand: unique symbol;
declare const terrainSurfaceTextureKeyBrand: unique symbol;
declare const terrainCompositionTextureKeyBrand: unique symbol;

/** Logical DAT-backed two-dimensional texture; packing is a replaceable physical binding. */
export type AssetTextureKey =
	`asset-texture:${TexturePurpose}:${TextureSourceId}` & {
		readonly [assetTextureKeyBrand]: true;
	};

/** Stable identity for one complete, immutable texture-array resource. */
export type TextureArrayKey = `texture-array:${TexturePurpose}:${string}` & {
	readonly [textureArrayKeyBrand]: true;
};

/** Stable generated pcode field for one landblock and mesh stride. */
export type TerrainSurfaceTextureKey = `terrain-surface:${LandblockOwnerId}` & {
	readonly [terrainSurfaceTextureKeyBrand]: true;
};

/** Stable generated terrain-composition lookup table for one installed active region. */
export type TerrainCompositionTextureKey = `terrain-composition:${string}` & {
	readonly [terrainCompositionTextureKeyBrand]: true;
};

/** Stable identity for a generated two-dimensional texture resource. */
export type GeneratedTextureKey =
	TerrainSurfaceTextureKey | TerrainCompositionTextureKey;

/** Logical identity for an atlas entry, asset texture, array, or generated texture. */
export type TextureKey =
	AssetTextureKey | TextureArrayKey | GeneratedTextureKey;

interface TextureArrayFactBase {
	readonly kind: "array";
	readonly key: TextureArrayKey;
	readonly sourceAssetIds: readonly DatAssetId[];
}

/** Exact normalized RGB lookup indexed by authored terrain code 0..31. */
export interface TerrainColorPalette {
	readonly colors: Float32Array;
}

/** Terrain-color array identity plus the complete regional code-to-source join. */
export interface TerrainColorTextureArrayFact extends TextureArrayFactBase {
	readonly purpose: TexturePurpose.TerrainColor;
	/** One source identity for each authored terrain code in numeric order. */
	readonly sourceAssetIdsByTerrainCode: readonly DatAssetId[];
}

/** Array purposes with no CPU-side terrain palette publication. */
export interface ConventionalTextureArrayFact extends TextureArrayFactBase {
	readonly purpose:
		TexturePurpose.TerrainBlendMask | TexturePurpose.TerrainRoadMask;
}

/** Complete source identity for one immutable texture-array resource. */
export type TextureArrayFact =
	TerrainColorTextureArrayFact | ConventionalTextureArrayFact;

/** Complete source identity for one DAT-backed two-dimensional logical texture. */
export interface AssetTextureFact {
	readonly kind: "asset";
	readonly key: AssetTextureKey;
	readonly purpose: TexturePurpose;
	readonly sourceAssetId: TextureSourceId;
	/**
	 * Recipe for a composited palette. Present only on an {@link TexturePurpose.ObjectPalette}
	 * fact whose material carries an ObjDesc composition; its absence means there is none, and the
	 * host never derives one from `sourceAssetId`.
	 */
	readonly paletteComposite?: PaletteComposite;
}

/** One complete logical texture resource to materialize from DAT texture sources. */
export type TextureFact = TextureArrayFact | AssetTextureFact;

export enum TexturePixelFormat {
	RGBA8 = "rgba8",
	R8 = "r8",
	RG8 = "rg8",
	A8 = "a8",
}

/** Return the exact byte width of one texel in a prepared texture format. */
export function texturePixelFormatByteLength(
	format: TexturePixelFormat,
): number {
	switch (format) {
		case TexturePixelFormat.RGBA8:
			return 4;
		case TexturePixelFormat.R8:
		case TexturePixelFormat.A8:
			return 1;
		case TexturePixelFormat.RG8:
			return 2;
	}
}

/** Return the complete mip level count down to one texel for positive dimensions. */
export function completeTextureMipLevelCount(
	width: number,
	height: number,
): number {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error("Texture dimensions must be positive integers.");
	}
	return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/** Return retained device bytes for one normalized texture and allocated mip range. */
export function textureMipChainByteLength(options: {
	readonly format: TexturePixelFormat;
	readonly height: number;
	readonly mipLevels: number;
	readonly width: number;
}): number {
	const maximumMipLevels = completeTextureMipLevelCount(
		options.width,
		options.height,
	);
	if (
		!Number.isInteger(options.mipLevels) ||
		options.mipLevels <= 0 ||
		options.mipLevels > maximumMipLevels
	) {
		throw new Error(
			`Texture mip level count must be between 1 and ${maximumMipLevels}.`,
		);
	}
	const bytesPerPixel = texturePixelFormatByteLength(options.format);
	let total = 0;
	let width = options.width;
	let height = options.height;
	for (let level = 0; level < options.mipLevels; level += 1) {
		total += width * height * bytesPerPixel;
		width = Math.max(1, Math.floor(width / 2));
		height = Math.max(1, Math.floor(height / 2));
	}
	return total;
}

/** Source-local draw-time sampling selected independently from texture resource identity. */
export interface TextureSamplerPolicy {
	/** Source-local UV edge behavior implemented by the object shader and prepared gutters. */
	readonly wrap: TextureWrapMode;
}

/** Purpose-owned accessible mip range with no independently invalid eligibility and cap fields. */
export type TextureMipPolicy =
	| { readonly kind: "level-zero" }
	| { readonly kind: "complete" }
	| {
			readonly kind: "maximum-level";
			/** Inclusive maximum mip level accessible to generation and sampling. */
			readonly maximumLevel: number;
	  };

/** Device-relevant policy fixed by a texture's semantic purpose. */
export interface TexturePurposePolicy {
	/** Physical pixel format uploaded to the graphics device. */
	readonly format: TexturePixelFormat;
	/** Accessible mip range allocated and generated independently from current filtering quality. */
	readonly mipPolicy: TextureMipPolicy;
}

/** Test whether a purpose is supported by the fixed-page static-object atlas. */
export function isPackedObjectTexturePurpose(
	purpose: TexturePurpose,
): purpose is PackedObjectTexturePurpose {
	return (
		purpose === TexturePurpose.ObjectDirectColor ||
		purpose === TexturePurpose.ObjectIndex8 ||
		purpose === TexturePurpose.ObjectIndex16 ||
		purpose === TexturePurpose.ObjectPalette
	);
}

/**
 * Return the canonical packing preparation for one static-object atlas purpose. This belongs to
 * purpose policy so layout metadata cannot drift from pixel materialization.
 */
export function packedObjectTexturePreparation(
	purpose: TexturePurpose,
): TexturePreparation {
	switch (purpose) {
		case TexturePurpose.ObjectDirectColor:
			return {
				gutterPixels: STATIC_OBJECT_TEXTURE_GUTTER_PIXELS,
				// Source-local UV clamping happens before atlas mapping; repeat-safe edge texels
				// support both draw-time wrap policies without duplicating the logical texture.
				wrap: TextureWrapMode.Repeat,
			};
		case TexturePurpose.ObjectIndex8:
		case TexturePurpose.ObjectIndex16:
		case TexturePurpose.ObjectPalette:
			return { gutterPixels: 0, wrap: TextureWrapMode.Clamp };
		default:
			throw new Error(
				`Texture purpose ${purpose} is not packable for static buildings.`,
			);
	}
}

/** Return the deepest mip whose base-level footprint fits within one prepared gutter. */
export function gutterIsolatedMaximumMipLevel(
	gutterPixels: TextureGutterPixels,
): number {
	return Math.floor(Math.log2(Math.max(1, gutterPixels)));
}

/** Resolve one purpose's promised accessible mip count for validated texture dimensions. */
export function texturePurposeMipLevelCount(
	purpose: TexturePurpose,
	width: number,
	height: number,
): number {
	const completeMipLevels = completeTextureMipLevelCount(width, height);
	const mipPolicy = texturePurposePolicy(purpose).mipPolicy;
	switch (mipPolicy.kind) {
		case "level-zero":
			return 1;
		case "complete":
			return completeMipLevels;
		case "maximum-level":
			return Math.min(completeMipLevels, mipPolicy.maximumLevel + 1);
	}
}

/** Build the canonical identity for one DAT-backed two-dimensional texture. */
export function createAssetTextureKey(
	purpose: TexturePurpose,
	sourceAssetId: TextureSourceId,
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

/** Build the canonical generated pcode-field identity for one landblock. */
export function createTerrainSurfaceTextureKey(
	landblockId: LandblockOwnerId,
): TerrainSurfaceTextureKey {
	return `terrain-surface:${landblockId}` as TerrainSurfaceTextureKey;
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
	sourceAssetId: TextureSourceId,
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
				mipPolicy: { kind: "complete" },
			};
		case TexturePurpose.ObjectDirectColor:
			return {
				format: TexturePixelFormat.RGBA8,
				mipPolicy: {
					kind: "maximum-level",
					maximumLevel: gutterIsolatedMaximumMipLevel(
						STATIC_OBJECT_TEXTURE_GUTTER_PIXELS,
					),
				},
			};
		case TexturePurpose.TerrainBlendMask:
		case TexturePurpose.TerrainRoadMask:
			return {
				format: TexturePixelFormat.R8,
				mipPolicy: { kind: "level-zero" },
			};
		case TexturePurpose.ObjectIndex8:
			return {
				format: TexturePixelFormat.R8,
				mipPolicy: { kind: "level-zero" },
			};
		case TexturePurpose.ObjectIndex16:
			return {
				format: TexturePixelFormat.RG8,
				mipPolicy: { kind: "level-zero" },
			};
		case TexturePurpose.ObjectPalette:
			return {
				format: TexturePixelFormat.RGBA8,
				mipPolicy: { kind: "level-zero" },
			};
	}
}
