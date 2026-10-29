import type {
	PreparedAnimation,
	PreparedAnimationFrame,
} from "./animation-asset-repository";
import { createRotationMat4FromQuaternionComponents } from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";

/**
 * Retail's smallest framerate that advances a cursor (`acclient.c:327122`).
 *
 * Mirrored from the host sequence runtime so a reversed clip is entered at the same frame on both
 * ends of the projection. Unrelated to the rotation epsilon further down, which happens to share
 * the value.
 */
const ADVANCING_FRAMERATE_EPSILON = 0.0002;

/**
 * One prepared animation traversed over an inclusive frame window at a signed rate.
 *
 * The three facts are inseparable: a window only means something against the animation it indexes,
 * and the rate's sign decides which end of that window playback enters at. A setup-default
 * animation is the whole-range case; a motion table names every other window.
 */
export interface PlayingClip {
	readonly animation: PreparedAnimation;
	/** Terminal behavior derived from the authoritative sequence's cyclic-tail boundary. */
	readonly completion: "hold" | "loop";
	/** Inclusive traversal bounds within the animation's frames. */
	readonly lowFrame: number;
	readonly highFrame: number;
	/** Negative traverses the window backwards; zero holds the entry frame. */
	readonly framesPerSecond: number;
}

/** Pure cyclic traversal result; hooks belong to departed frames, never interpolation endpoints. */
export interface CyclicFrameAdvance {
	readonly framePosition: number;
	readonly departedFrames: readonly number[];
}

/** Bind a traversal window to the animation it indexes, rejecting one that does not fit. */
export function playingClip(
	animation: PreparedAnimation,
	lowFrame: number,
	highFrame: number,
	framesPerSecond: number,
	completion: PlayingClip["completion"],
): PlayingClip {
	if (!Number.isInteger(lowFrame) || !Number.isInteger(highFrame))
		throw new Error(`Clip window for ${animation.id} must be whole frames.`);
	if (lowFrame < 0 || lowFrame > highFrame || highFrame >= animation.frameCount)
		throw new Error(
			`Clip window [${lowFrame}, ${highFrame}] does not fit animation ${animation.id}'s ${animation.frameCount} frames.`,
		);
	if (!Number.isFinite(framesPerSecond))
		throw new Error(`Clip rate for ${animation.id} must be finite.`);
	return { animation, completion, framesPerSecond, highFrame, lowFrame };
}

/** The whole animation forward at its authored rate, which is the setup-default resident's clip. */
export function wholeAnimationClip(animation: PreparedAnimation): PlayingClip {
	return playingClip(
		animation,
		0,
		animation.frameCount - 1,
		animation.framesPerSecond,
		"loop",
	);
}

/**
 * Frame playback enters a clip at, and returns to when it laps.
 *
 * A reversed clip starts just inside the high frame rather than on it, so the first departure
 * leaves the high frame rather than skipping it — retail's `AnimSequenceNode::get_starting_frame`
 * (`acclient.c:327012-327021`), matched here so the host sequence and the rendered clip agree on
 * the entry pose without exchanging a frame number.
 */
export function clipEntryFrame(clip: PlayingClip): number {
	return clip.framesPerSecond >= 0
		? clip.lowFrame
		: clip.highFrame + 1 - ADVANCING_FRAMERATE_EPSILON;
}

/**
 * Traverse one clip's window iteratively while preserving retail's seam-hook exclusions.
 *
 * Reaching the far bound either laps or holds according to the host's cyclic-tail classification.
 * The frontend cannot derive that distinction from an animation window: the same asset may be a
 * transition in one sequence and part of the looping tail in another.
 */
export function advancePlayingFrame(
	clip: PlayingClip,
	framePosition: number,
	elapsedSeconds: number,
): CyclicFrameAdvance {
	if (!Number.isFinite(framePosition) || !Number.isFinite(elapsedSeconds))
		throw new Error("Animation frame traversal requires finite values.");
	if (elapsedSeconds < 0)
		throw new Error("Animation frame traversal cannot consume negative time.");
	let position = normalizeClipFrame(clip, framePosition);
	let remaining = Math.abs(elapsedSeconds * clip.framesPerSecond);
	const forward = clip.framesPerSecond >= 0;
	const departedFrames: number[] = [];
	while (remaining > 0) {
		if (forward) {
			const seamDistance = clip.highFrame + 1 - position;
			const end =
				remaining >= seamDistance ? clip.highFrame : position + remaining;
			for (
				let frame = Math.floor(position);
				frame < Math.floor(end);
				frame += 1
			) {
				departedFrames.push(frame);
			}
			if (remaining < seamDistance)
				return { departedFrames, framePosition: end };
			if (clip.completion === "hold")
				return { departedFrames, framePosition: clip.highFrame };
			remaining -= seamDistance;
		} else {
			const seamDistance = position - clip.lowFrame;
			if (remaining <= seamDistance) {
				const end = position - remaining;
				for (
					let frame = Math.floor(position);
					frame > Math.floor(end);
					frame -= 1
				) {
					departedFrames.push(frame);
				}
				return { departedFrames, framePosition: end };
			}
			for (
				let frame = Math.floor(position);
				frame > clip.lowFrame;
				frame -= 1
			) {
				departedFrames.push(frame);
			}
			remaining -= seamDistance;
			if (clip.completion === "hold")
				return { departedFrames, framePosition: clip.lowFrame };
		}
		position = clipEntryFrame(clip);
	}
	return { departedFrames, framePosition: position };
}

/** Sample frame-major rigid part poses without changing semantic frame or hook state. */
export function sampleAnimationPose(
	clip: PlayingClip,
	framePosition: number,
): readonly Mat4[] {
	const { animation } = clip;
	const { lowerFrame, upperFrame, fraction } = resolveFrameBlend(
		clip,
		framePosition,
	);
	const parts: Mat4[] = [];
	for (let part = 0; part < animation.partCount; part += 1) {
		parts.push(
			sampleAnimationPart(animation, lowerFrame, upperFrame, fraction, part),
		);
	}
	return parts;
}

/**
 * Apply the prefix one animation authors over a complete retained setup pose.
 *
 * Retail updates only `min(setup parts, animation-frame parts)` and leaves every higher setup part
 * untouched (`CPartArray::UpdateParts`, acclient.c:314107-314135). The returned array therefore
 * remains a complete setup-indexed pose even when the clip intentionally authors fewer parts.
 */
export function sampleAnimationPoseOver(
	clip: PlayingClip,
	framePosition: number,
	retainedPartToObjectTransforms: readonly Mat4[],
): readonly Mat4[] {
	const sampled = sampleAnimationPose(clip, framePosition);
	const coveredPartCount = Math.min(
		retainedPartToObjectTransforms.length,
		sampled.length,
	);
	// Full-coverage clips are the frame-hot golden path and already produced a complete pose.
	if (sampled.length === retainedPartToObjectTransforms.length) return sampled;

	const completePose = sampled.slice(0, coveredPartCount);
	for (
		let partIndex = coveredPartCount;
		partIndex < retainedPartToObjectTransforms.length;
		partIndex++
	) {
		completePose.push(retainedPartToObjectTransforms[partIndex]!.clone());
	}
	return completePose;
}

/** A part's historical seed and its independently mutable current presentation. */
interface SampledPosePart {
	/** Installation/transition value preserved beneath partial clips. */
	readonly seed: Mat4;
	/** Playback-owned matrix reused only for current samples. */
	readonly current: Mat4;
}

/**
 * Own the distinction between historical clip seeds and current presentation storage.
 * Frame sampling borrows the current pose; transitions explicitly request an independent snapshot.
 * No matrix storage is shared between installations, tracks, seeds or snapshots.
 */
export class AnimationPoseSampler {
	/** Seed/current pairs keep partial-part retention independent of mutable output. */
	readonly #parts: readonly SampledPosePart[];
	/** Stable setup-indexed view of the current matrices, borrowed by synchronous publication. */
	readonly #current: readonly Mat4[];

	constructor(initialPose: readonly Mat4[]) {
		this.#parts = initialPose.map((matrix) => ({
			seed: matrix.clone(),
			current: matrix.clone(),
		}));
		this.#current = this.#parts.map((part) => part.current);
	}

	/** Update this playback's current pose; callers must snapshot any historical value they retain. */
	updateCurrent(clip: PlayingClip, framePosition: number): readonly Mat4[] {
		const { lowerFrame, upperFrame, fraction } = resolveFrameBlend(
			clip,
			framePosition,
		);
		let partIndex = 0;
		for (const part of this.#parts) {
			if (partIndex < clip.animation.partCount) {
				sampleAnimationPart(
					clip.animation,
					lowerFrame,
					upperFrame,
					fraction,
					partIndex,
					part.current,
				);
			} else {
				part.current.copy(part.seed);
			}
			partIndex++;
		}
		return this.#current;
	}

	/** Copy an exact projected pose for a successor without modifying current publication storage. */
	snapshot(clip: PlayingClip, framePosition: number): readonly Mat4[] {
		return sampleAnimationPoseOver(
			clip,
			framePosition,
			this.#parts.map((part) => part.seed),
		);
	}
}

/** Sample one validated authored part, sharing interpolation between snapshots and current poses. */
function sampleAnimationPart(
	animation: PreparedAnimation,
	lowerFrame: number,
	upperFrame: number,
	fraction: number,
	partIndex: number,
	targetMatrix?: Mat4,
): Mat4 {
	const lower =
		animation.partFrames[lowerFrame * animation.partCount + partIndex];
	const upper =
		animation.partFrames[upperFrame * animation.partCount + partIndex];
	if (!lower || !upper)
		throw new Error(
			`Animation ${animation.id} has an incomplete sampled pose.`,
		);
	return interpolateRigidTransform(lower, upper, fraction, targetMatrix);
}

/**
 * Whether this animation's authored root frames are applied to the visual root.
 *
 * The single predicate behind both the sampled transform and the culling bound that has to cover
 * it. Spelling it twice would let a bound stop covering a pose it still renders.
 */
export function turnsVisualRoot(animation: PreparedAnimation): boolean {
	return (
		animation.positionFrames.length > 0 && !animation.authoredRootTranslates
	);
}

/**
 * Sample the authored root frame this clip is on, or `null` when it authors none.
 *
 * RETAIL DIVERGENCE: retail composes authored root frames into the object's *world* frame every
 * update (`CPhysicsObj::UpdatePositionInternal`, acclient.c:308262-308298), which carries collision
 * along with the visual. Holtburger applies them to the **visual root only**, because an object's
 * position here is owned by a solver or by a static collider that a presentation sample must not
 * fight.
 *
 * Consequence of "correcting" it: routing these frames back into world placement would hand
 * frontend animation authority over collision, which is the one thing the dynamic-entity contract
 * exists to prevent.
 *
 * Why content cannot observe the difference: a translating root is refused outright by
 * `authoredRootTranslates`, so only turning is ever applied, and a turn cannot separate a model
 * from the thing that owns where it stands. Census 2026-08-20 over all 5,935 archive setups — 129
 * declare a bare default animation, exactly one authors root motion (setup 0x02001752, WCID 36449
 * Bats: zero translation, 0.44 degrees of yaw per frame), and zero carriers are collidable, since
 * that one resolves to `EntityCollisionParticipation::Suppressed`.
 */
export function sampleAuthoredRootTransform(
	clip: PlayingClip,
	framePosition: number,
): Mat4 | null {
	const { animation } = clip;
	if (!turnsVisualRoot(animation)) return null;
	const { lowerFrame, upperFrame, fraction } = resolveFrameBlend(
		clip,
		framePosition,
	);
	const lower = animation.positionFrames[lowerFrame];
	const upper = animation.positionFrames[upperFrame];
	if (!lower || !upper)
		throw new Error(
			`Animation ${animation.id} has an incomplete authored root frame.`,
		);
	return interpolateRigidTransform(lower, upper, fraction);
}

/**
 * The two authored frames one clip position sits between, and how far between them it is.
 *
 * Shared by every sampler so they cannot disagree about where a position lands. The upper frame
 * clamps to the window's own high bound rather than wrapping: part indices need not identify
 * spatially continuous geometry across a cyclic seam, so the seam holds its last frame instead of
 * blending into the first.
 */
function resolveFrameBlend(
	clip: PlayingClip,
	framePosition: number,
): { lowerFrame: number; upperFrame: number; fraction: number } {
	const normalized = normalizeClipFrame(clip, framePosition);
	const lowerFrame = Math.floor(normalized);
	return {
		fraction: normalized - lowerFrame,
		lowerFrame,
		upperFrame: Math.min(lowerFrame + 1, clip.highFrame),
	};
}

/** Fold any position back into `[lowFrame, highFrame + 1)`, so traversal is total. */
function normalizeClipFrame(clip: PlayingClip, framePosition: number): number {
	const span = clip.highFrame - clip.lowFrame + 1;
	return clip.lowFrame + modulo(framePosition - clip.lowFrame, span);
}

/** Interpolate rigid transforms, optionally writing into caller-owned matrix storage. */
export function interpolateRigidTransform(
	from: PreparedAnimationFrame,
	to: PreparedAnimationFrame,
	fraction: number,
	targetMatrix?: Mat4,
): Mat4 {
	if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
		throw new Error("Rigid interpolation fraction must be within [0, 1].");
	const result = interpolateRotationMat4(
		from.rotation,
		to.rotation,
		fraction,
		targetMatrix,
	);
	result.m41 =
		from.translation.x + (to.translation.x - from.translation.x) * fraction;
	result.m42 =
		from.translation.y + (to.translation.y - from.translation.y) * fraction;
	result.m43 =
		from.translation.z + (to.translation.z - from.translation.z) * fraction;
	return result;
}

/** Exact delta quaternion for one render-space axis-angle vector. */
export function rotationVectorQuaternion(rotation: Vec3): Quat {
	const magnitude = Math.hypot(rotation.x, rotation.y, rotation.z);
	if (magnitude === 0) return Quat.identity();
	const half = magnitude / 2;
	const scalar = Math.sin(half) / magnitude;
	return new Quat(
		Math.cos(half),
		rotation.x * scalar,
		rotation.y * scalar,
		rotation.z * scalar,
	);
}

/** Smallest rotation vector retail's `Frame::grotate` treats as a rotation at all. */
const ROTATION_VECTOR_EPSILON = 0.0002;

/** Retail `Frame::grotate` ignores committed rotation vectors below its authored epsilon. */
export function retailRotationVectorQuaternion(rotation: Vec3): Quat {
	return Math.hypot(rotation.x, rotation.y, rotation.z) <
		ROTATION_VECTOR_EPSILON
		? Quat.identity()
		: rotationVectorQuaternion(rotation);
}

/** Hamilton product used by retail global rotation: `delta * current`. */
export function multiplyQuaternion(left: Quat, right: Quat): Quat {
	return normalizeQuaternion(
		new Quat(
			left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
			left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
			left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
			left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
		),
	);
}

/** Interpolate directly into the owned result matrix; quaternion intermediates never escape. */
function interpolateRotationMat4(
	from: Readonly<Quat>,
	to: Readonly<Quat>,
	fraction: number,
	targetMatrix?: Mat4,
): Mat4 {
	let targetW = to.w;
	let targetX = to.x;
	let targetY = to.y;
	let targetZ = to.z;
	let dot = from.w * to.w + from.x * to.x + from.y * to.y + from.z * to.z;
	if (dot < 0) {
		dot = -dot;
		targetW = -targetW;
		targetX = -targetX;
		targetY = -targetY;
		targetZ = -targetZ;
	}
	if (dot > 0.9995) {
		const w = from.w + (targetW - from.w) * fraction;
		const x = from.x + (targetX - from.x) * fraction;
		const y = from.y + (targetY - from.y) * fraction;
		const z = from.z + (targetZ - from.z) * fraction;
		const magnitude = Math.hypot(w, x, y, z);
		if (magnitude === 0) throw new Error("Cannot normalize a zero quaternion.");
		return createRotationMat4FromQuaternionComponents(
			w / magnitude,
			x / magnitude,
			y / magnitude,
			z / magnitude,
			targetMatrix,
		);
	}
	const angle = Math.acos(Math.min(1, dot));
	const denominator = Math.sin(angle);
	const fromWeight = Math.sin((1 - fraction) * angle) / denominator;
	const toWeight = Math.sin(fraction * angle) / denominator;
	return createRotationMat4FromQuaternionComponents(
		from.w * fromWeight + targetW * toWeight,
		from.x * fromWeight + targetX * toWeight,
		from.y * fromWeight + targetY * toWeight,
		from.z * fromWeight + targetZ * toWeight,
		targetMatrix,
	);
}

function normalizeQuaternion(value: Quat): Quat {
	const magnitude = Math.hypot(value.w, value.x, value.y, value.z);
	if (magnitude === 0) throw new Error("Cannot normalize a zero quaternion.");
	return new Quat(
		value.w / magnitude,
		value.x / magnitude,
		value.y / magnitude,
		value.z / magnitude,
	);
}

function modulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}
