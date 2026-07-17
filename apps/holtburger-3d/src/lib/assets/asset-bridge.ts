import type { ResolvedLandblockLayerSource } from "../game/resolution/landblock-layer";
import type { LandblockIdLayer } from "../game/runtime/scene-interest";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";

/** Port through which game systems request canonical resolved assets. */
export interface AssetBridge {
	resolveLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<ResolvedLandblockLayerSource>;
	/** Serve one host asset request issued by a CPU texture-preparation worker. */
	requestTexturePreparationAsset(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse>;
}
