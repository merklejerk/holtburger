import type { DatAssetId } from "../game-types";

export enum TextureGutterPolicy {
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
	TerrainDetail = "terrain-detail",
	TerrainRoadMask = "terrain-road-mask",
	ObjectDirectColor = "object-direct-color",
	ObjectIndex = "object-index",
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
