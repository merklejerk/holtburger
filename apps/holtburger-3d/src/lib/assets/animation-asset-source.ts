import type { DatAssetId } from "../game/game-types";
import type { DecodedAnimationAsset } from "./decode-animation-record";

/** Host adapter boundary for immutable decoded DAT animation assets. */
export interface AnimationAssetSource {
	loadAnimation(animationId: DatAssetId): Promise<DecodedAnimationAsset>;
	/**
	 * Every animation one motion table can reach, through cycles, modifiers, and links.
	 *
	 * The host answers from the projected motion contract, which resolved every reference when it
	 * was built, so this set can never name an animation the archive lacks.
	 */
	loadMotionTableClosure(motionTableId: DatAssetId): Promise<DatAssetId[]>;
	destroy(): void;
}
