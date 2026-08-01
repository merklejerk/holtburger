import type { DatAssetId } from "../game/game-types";
import type { DecodedAnimationAsset } from "./decode-animation-record";

/** Host adapter boundary for immutable decoded DAT animation assets. */
export interface AnimationAssetSource {
	loadAnimation(animationId: DatAssetId): Promise<DecodedAnimationAsset>;
	destroy(): void;
}
