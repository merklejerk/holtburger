import type { PreparedAssetReader } from "../../../assets/contracts";
import {
	createPreparedPaletteTextureHostKey,
	createPreparedTextureHostKey,
	prepareDirectMaterialTextureSource,
	type DirectMaterialTextureSource,
} from "../../../assets/preparation/prepared-texture-source";
import type { MaterialTextureDataUseIdentity } from "../../../static/contracts";
import type { TexturePackingPixelSource } from "../../../textures/packing/protocol";

export async function prepareMaterialTexturePackingSource(options: {
	readonly assetReader: PreparedAssetReader;
	readonly dataUse: MaterialTextureDataUseIdentity;
}): Promise<TexturePackingPixelSource> {
	const prepared = await options.assetReader.requestPreparedAsset(
		createMaterialTextureHostKey(options.dataUse),
	);
	return createTexturePackingPixelSource(
		prepareDirectMaterialTextureSource(prepared, options.dataUse),
	);
}

function createMaterialTextureHostKey(
	source: MaterialTextureDataUseIdentity,
) {
	if (source.kind === "prepared-palette-texture-use") {
		return createPreparedPaletteTextureHostKey(source);
	}

	return createPreparedTextureHostKey(source);
}

function createTexturePackingPixelSource(
	source: DirectMaterialTextureSource,
): TexturePackingPixelSource {
	if (source.kind === "direct-rgba-texture-source") {
		return {
			format: "rgba8",
			height: source.height,
			kind: "texture-packing-pixel-source",
			pixels: source.pixels,
			width: source.width,
		};
	}

	if (source.kind === "direct-index-texture-source") {
		return {
			format: source.usage === "index8" ? "r8" : "rg8",
			height: source.height,
			kind: "texture-packing-pixel-source",
			pixels: source.indices,
			width: source.width,
		};
	}

	return {
		format: "rgba8",
		height: source.height,
		kind: "texture-packing-pixel-source",
		pixels: source.pixels,
		width: source.width,
	};
}
