import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";

/** Narrow host capability for one validated, pixel-bearing terrain texture request. */
export interface TexturePixelSource {
	loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse>;
}
