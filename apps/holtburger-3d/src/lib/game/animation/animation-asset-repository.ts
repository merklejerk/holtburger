import { collectEmitterInfoIds } from "../behavior/behavior-dependencies";
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
import { quaternionFromRotationMat4 } from "../math/matrices";
import { type Mat4, type Quat, Vec3 } from "../math/types";

/** Retail setup-default animation rate installed by retail part-array defaults. */
const STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND = 30;

/** Shared interpolation endpoints, decomposed once during asset preparation. */
export interface PreparedAnimationFrame {
	/** Normalized orientation in the app's render coordinate system. */
	readonly rotation: Readonly<Quat>;
	/** Part-to-object translation or authored root offset, never a world placement. */
	readonly translation: Readonly<Vec3>;
}

/** Immutable prepared animation shared independently from entity playback state. */
export interface PreparedAnimation {
	readonly id: DatAssetId;
	readonly frameCount: number;
	readonly partCount: number;
	readonly framesPerSecond: number;
	/** Frame-major rigid-part transforms indexed by `frame * partCount + part`. */
	readonly partFrames: readonly PreparedAnimationFrame[];
	/** Optional frame-major authored root offsets. */
	readonly positionFrames: readonly PreparedAnimationFrame[];
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
	/** Direct hook assets, shared with script dependency discovery. */
	readonly emitterInfoIds: readonly DatAssetId[];
}

export type PreparedAnimationHandle = PreparedAssetHandle<PreparedAnimation>;

/**
 * Available animations from one motion table, held together and released as one unit.
 *
 * Attempt the complete table before activation; an unavailable clip retains the current pose.
 * Transitions never load at frame time.
 */
export interface PreparedMotionAssets {
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
			retention: "referenced",
			destroySource: () => source.destroy(),
			label: "Animation",
			load: (animationId) => source.loadAnimation(animationId),
			prepare: prepareAnimation,
		});
		this.#source = source;
	}

	/**
	 * Stage the available animations one motion table can reach. Source failures omit individual
	 * clips; an operational failure releases all acquired siblings and rejects the operation.
	 *
	 * The whole table is staged rather than the set reachable from the current stance, because a
	 * stance change would otherwise stage at command time — the same defect in a different costume.
	 */
	async acquireMotionAssets(
		motionTableId: DatAssetId,
	): Promise<PreparedMotionAssets> {
		const animationIds =
			await this.#source.loadMotionTableClosure(motionTableId);
		const handles = await this.acquireAvailable(animationIds);
		const releaseAll = () => {
			for (const handle of handles.values()) handle?.release();
		};

		const animations = new Map<DatAssetId, PreparedAnimation>(
			[...handles].flatMap(([animationId, handle]) =>
				handle === null ? [] : [[animationId, handle.asset] as const],
			),
		);
		let released = false;
		return {
			animations,
			motionTableId,
			release: () => {
				if (released)
					throw new Error(`Motion assets for ${motionTableId} released twice.`);
				released = true;
				releaseAll();
			},
		};
	}
}

/** Prepare a decoded animation for a caller-owned playback rate. */
export function prepareAnimation(
	decoded: DecodedAnimationAsset,
	expectedId: DatAssetId,
	framesPerSecond = STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND,
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
	if (!Number.isFinite(framesPerSecond) || framesPerSecond === 0) {
		throw new Error(
			`Animation ${decoded.id} playback rate must be finite and non-zero.`,
		);
	}
	return {
		authoredRootTranslates: decoded.positionFrames.some(
			(frame) => frame.m41 !== 0 || frame.m42 !== 0 || frame.m43 !== 0,
		),
		frameCount: decoded.frameCount,
		framesPerSecond,
		hooks: decoded.hooks,
		emitterInfoIds: collectEmitterInfoIds(decoded.hooks),
		id: decoded.id,
		partCount: decoded.partCount,
		partFrames: decoded.partFrames.map(prepareAnimationFrame),
		positionFrames: decoded.positionFrames.map(prepareAnimationFrame),
	};
}

/** Preserve the decoder's coordinate conversion and the sampler's existing rotation extraction. */
function prepareAnimationFrame(frame: Mat4): PreparedAnimationFrame {
	return {
		rotation: quaternionFromRotationMat4(frame),
		translation: new Vec3(frame.m41, frame.m42, frame.m43),
	};
}
