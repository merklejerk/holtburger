import type { ResolvedLandblockLayerSource } from "../game/resolution/landblock-layer";
import type { LandblockIdLayer } from "../game/runtime/scene-interest";

/** Port through which game systems request canonical resolved assets. */
export interface AssetBridge {
	resolveLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<ResolvedLandblockLayerSource>;
}
