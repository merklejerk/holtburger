import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type {
	DecodedAnimationAsset,
	DecodedAnimationHook,
} from "../../assets/decode-animation-record";
import {
	PreparedAssetRepository,
	type PreparedAssetHandle,
} from "../behavior/prepared-asset-repository";
import type { DatAssetId } from "../game-types";
import type { Mat4 } from "../math/types";

/** Retail setup-default animation rate installed by `CPartArray::InitDefaults`. */
const STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND = 30;

/** Immutable prepared animation shared independently from entity playback state. */
export interface PreparedAnimation {
	readonly id: DatAssetId;
	readonly frameCount: number;
	readonly partCount: number;
	readonly framesPerSecond: number;
	/** Frame-major rigid-part transforms indexed by `frame * partCount + part`. */
	readonly partFrames: readonly Mat4[];
	/** Optional frame-major root offsets retained but unused by static-default playback. */
	readonly positionFrames: readonly Mat4[];
	readonly hooks: readonly DecodedAnimationHook[];
}

export type PreparedAnimationHandle = PreparedAssetHandle<PreparedAnimation>;

/** Shares immutable animation transfer/preparation over the common asset lifecycle. */
export class AnimationAssetRepository extends PreparedAssetRepository<
	DecodedAnimationAsset,
	PreparedAnimation
> {
	constructor(source: AnimationAssetSource) {
		super({
			destroySource: () => source.destroy(),
			label: "Animation",
			load: (animationId) => source.loadAnimation(animationId),
			prepare: prepareAnimation,
		});
	}
}

function prepareAnimation(
	decoded: DecodedAnimationAsset,
	expectedId: DatAssetId,
): PreparedAnimation {
	if (decoded.id.toLowerCase() !== expectedId.toLowerCase())
		throw new Error(
			`Animation source returned ${decoded.id} for ${expectedId}.`,
		);
	if (decoded.partFrames.length !== decoded.frameCount * decoded.partCount) {
		throw new Error(
			`Animation ${decoded.id} has an incomplete rigid-part frame table.`,
		);
	}
	if (
		decoded.positionFrames.length !== 0 &&
		decoded.positionFrames.length !== decoded.frameCount
	) {
		throw new Error(
			`Animation ${decoded.id} has an incomplete position-frame table.`,
		);
	}
	return {
		frameCount: decoded.frameCount,
		framesPerSecond: STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND,
		hooks: decoded.hooks,
		id: decoded.id,
		partCount: decoded.partCount,
		partFrames: decoded.partFrames,
		positionFrames: decoded.positionFrames,
	};
}
