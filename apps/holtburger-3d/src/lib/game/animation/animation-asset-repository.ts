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
	// RETAIL DIVERGENCE: retail composes these authored root position frames into the object's
	// world frame every update (`CPhysicsObj::UpdatePositionInternal`, acclient.c:308262-308298).
	// Holtburger keeps the spawned-dynamic root solver-owned and never applies position frames;
	// `sampleAnimationPose` reads only `partFrames`. Correcting it *here* would route frontend
	// animation back into collision authority, which is why the fix does not belong in this file.
	//
	// Consequence: WCID 36449 Bats animates without its authored root rotation. Diagnosed
	// 2026-08-20 — the motion contract projects `setup_default_tables` (which motion *table* a
	// setup installs) but not `SetupModel::default_animation` (a bare animation for a setup with
	// no table). Confirmed against the catalog: 36449 declares no motion table, so nothing routes
	// its root frames host-side where the authored-drive path could apply them.
	//
	// Census: one canonical-catalog template, whose frames are rotation-only with zero
	// translation. Deferred because the projection would touch every setup-default resident to
	// serve one; see the authored-root-motion plan's debt table.
	/** Optional frame-major root offsets retained but never applied to the entity root. */
	readonly positionFrames: readonly Mat4[];
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
		frameCount: decoded.frameCount,
		framesPerSecond: STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND,
		hooks: decoded.hooks,
		id: decoded.id,
		partCount: decoded.partCount,
		partFrames: decoded.partFrames,
		positionFrames: decoded.positionFrames,
	};
}
