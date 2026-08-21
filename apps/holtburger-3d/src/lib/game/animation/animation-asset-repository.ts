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
	/** Optional frame-major authored root offsets. */
	readonly positionFrames: readonly Mat4[];
	/**
	 * Whether any authored root frame *moves* the object rather than only turning it.
	 *
	 * A turning root is safe to apply to the visual root: it cannot separate the model from
	 * whatever owns its position. A translating one can, so it is refused. Computed once here
	 * because it is a property of the asset, not of any entity playing it.
	 *
	 * Census 2026-08-20 over all 5,935 archive setups: 129 declare a bare default animation and
	 * exactly one authors root motion at all — setup 0x02001752 (WCID 36449 Bats), whose frames
	 * carry zero translation and 0.44 degrees of yaw each. No translating carrier exists, so this
	 * flag is a tripwire rather than a live branch.
	 */
	readonly authoredRootTranslates: boolean;
	readonly hooks: readonly DecodedAnimationHook[];
}

export type PreparedAnimationHandle = PreparedAssetHandle<PreparedAnimation>;

/**
 * Every animation one motion table can reach, held together and released as one unit.
 *
 * Activation needs the whole closure staged before the first clip plays, because a transition
 * reached mid-playback must not trigger a load at frame time — the same rule physics-script
 * closures already hold to.
 */
export interface PreparedMotionClosure {
	readonly motionTableId: DatAssetId;
	readonly animations: ReadonlyMap<DatAssetId, PreparedAnimation>;
	release(): void;
}

/** Shares immutable animation transfer/preparation over the common asset lifecycle. */
export class AnimationAssetRepository extends PreparedAssetRepository<
	DecodedAnimationAsset,
	PreparedAnimation
> {
	readonly #source: AnimationAssetSource;

	constructor(source: AnimationAssetSource) {
		super({
			destroySource: () => source.destroy(),
			label: "Animation",
			load: (animationId) => source.loadAnimation(animationId),
			prepare: prepareAnimation,
		});
		this.#source = source;
	}

	/**
	 * Acquire every animation one motion table can reach.
	 *
	 * The host resolves the set from the projected contract rather than the frontend walking a
	 * table it does not have. Acquisition is all-or-nothing: a failure anywhere releases every
	 * handle taken so far, so a partially staged closure can never reach activation.
	 *
	 * The whole table is staged rather than the set reachable from the current stance, because a
	 * stance change would otherwise stage at command time — the same defect in a different costume.
	 */
	async acquireMotionClosure(
		motionTableId: DatAssetId,
	): Promise<PreparedMotionClosure> {
		const animationIds =
			await this.#source.loadMotionTableClosure(motionTableId);
		const handles = new Map<DatAssetId, PreparedAnimationHandle>();
		const releaseAll = () => {
			for (const handle of handles.values()) handle.release();
			handles.clear();
		};
		try {
			for (const animationId of animationIds) {
				if (handles.has(animationId)) continue;
				try {
					handles.set(animationId, await this.acquire(animationId));
				} catch (cause) {
					throw new Error(
						`Motion closure for ${motionTableId} could not stage ${animationId}.`,
						{ cause },
					);
				}
			}
		} catch (cause) {
			releaseAll();
			throw cause;
		}

		const animations = new Map<DatAssetId, PreparedAnimation>(
			[...handles].map(([animationId, handle]) => [animationId, handle.asset]),
		);
		let released = false;
		return {
			animations,
			motionTableId,
			release: () => {
				if (released)
					throw new Error(
						`Motion closure for ${motionTableId} released twice.`,
					);
				released = true;
				releaseAll();
			},
		};
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
		authoredRootTranslates: decoded.positionFrames.some(
			(frame) => frame.m41 !== 0 || frame.m42 !== 0 || frame.m43 !== 0,
		),
		frameCount: decoded.frameCount,
		framesPerSecond: STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND,
		hooks: decoded.hooks,
		id: decoded.id,
		partCount: decoded.partCount,
		partFrames: decoded.partFrames,
		positionFrames: decoded.positionFrames,
	};
}
