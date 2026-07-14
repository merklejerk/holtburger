import type { DatAssetId } from "../game-types";

export enum TextureGutterPolicy {
	None = "none",
	Wrap4 = "wrap-4",
	Wrap8 = "wrap-8",
	Wrap16 = "wrap-32",
	Wrap64 = "wrap-64",
	Repeat4 = "repeat-4",
	Repeat8 = "repeat-8",
	Repeat16 = "repeat-32",
	Repeat64 = "repeat-64",
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

export type TextureKey =
	`${TexturePurpose}:${DatAssetId}/${TextureGutterPolicy}`;

export enum TexturePixelFormat {
	RGBA8 = "rgba8",
	R8 = "r8",
	RG8 = "rg8",
	A8 = "a8",
}

/** Return the one physical pixel format admitted by a semantic texture purpose. */
export function texturePixelFormatForPurpose(
	purpose: TexturePurpose,
): TexturePixelFormat {
	switch (purpose) {
		case TexturePurpose.TerrainColor:
		case TexturePurpose.TerrainDetail:
		case TexturePurpose.ObjectDirectColor:
		case TexturePurpose.ObjectPalette:
		case TexturePurpose.ObjectDetail:
			return TexturePixelFormat.RGBA8;
		case TexturePurpose.TerrainBlendMask:
		case TexturePurpose.TerrainRoadMask:
		case TexturePurpose.ObjectIndex8:
			return TexturePixelFormat.R8;
		case TexturePurpose.ObjectIndex16:
			return TexturePixelFormat.RG8;
	}
}
