import type { PreparedAnimation } from "./animation-asset-repository";
import { createRotationMat4 } from "../math/matrices";
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
): PlayingClip {
	if (!Number.isInteger(lowFrame) || !Number.isInteger(highFrame))
		throw new Error(`Clip window for ${animation.id} must be whole frames.`);
	if (lowFrame < 0 || lowFrame > highFrame || highFrame >= animation.frameCount)
		throw new Error(
			`Clip window [${lowFrame}, ${highFrame}] does not fit animation ${animation.id}'s ${animation.frameCount} frames.`,
		);
	if (!Number.isFinite(framesPerSecond))
		throw new Error(`Clip rate for ${animation.id} must be finite.`);
	return { animation, framesPerSecond, highFrame, lowFrame };
}

/** The whole animation forward at its authored rate, which is the setup-default resident's clip. */
export function wholeAnimationClip(animation: PreparedAnimation): PlayingClip {
	return playingClip(
		animation,
		0,
		animation.frameCount - 1,
		animation.framesPerSecond,
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
 * Reaching the far bound laps back to the entry frame rather than stopping. A motion table's
 * looping clip is projected once and never re-sent, so holding at the bound would freeze every
 * idle; the host's own sequence laps a lone cyclic node exactly this way. A one-shot transition
 * laps too, for at most the one host tick before the successor clip arrives.
 */
export function advanceCyclicFrame(
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
	const normalized = normalizeClipFrame(clip, framePosition);
	const lowerFrame = Math.floor(normalized);
	// Part indices need not identify spatially continuous geometry across a cyclic seam.
	const upperFrame = Math.min(lowerFrame + 1, clip.highFrame);
	const fraction = normalized - lowerFrame;
	const parts: Mat4[] = [];
	for (let part = 0; part < animation.partCount; part += 1) {
		const lower = animation.partFrames[lowerFrame * animation.partCount + part];
		const upper = animation.partFrames[upperFrame * animation.partCount + part];
		if (!lower || !upper)
			throw new Error(
				`Animation ${animation.id} has an incomplete sampled pose.`,
			);
		parts.push(interpolateRigidTransform(lower, upper, fraction));
	}
	return parts;
}

/** Fold any position back into `[lowFrame, highFrame + 1)`, so traversal is total. */
function normalizeClipFrame(clip: PlayingClip, framePosition: number): number {
	const span = clip.highFrame - clip.lowFrame + 1;
	return clip.lowFrame + modulo(framePosition - clip.lowFrame, span);
}

/** Interpolate translation linearly and orientation spherically between two rigid transforms. */
export function interpolateRigidTransform(
	from: Mat4,
	to: Mat4,
	fraction: number,
): Mat4 {
	if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
		throw new Error("Rigid interpolation fraction must be within [0, 1].");
	const rotation = slerpQuaternion(
		quaternionFromRigidTransform(from),
		quaternionFromRigidTransform(to),
		fraction,
	);
	const result = createRotationMat4(rotation);
	result.m41 = from.m41 + (to.m41 - from.m41) * fraction;
	result.m42 = from.m42 + (to.m42 - from.m42) * fraction;
	result.m43 = from.m43 + (to.m43 - from.m43) * fraction;
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

function quaternionFromRigidTransform(matrix: Mat4): Quat {
	const trace = matrix.m11 + matrix.m22 + matrix.m33;
	if (trace > 0) {
		const scale = Math.sqrt(trace + 1) * 2;
		return normalizeQuaternion(
			new Quat(
				scale / 4,
				(matrix.m23 - matrix.m32) / scale,
				(matrix.m31 - matrix.m13) / scale,
				(matrix.m12 - matrix.m21) / scale,
			),
		);
	}
	if (matrix.m11 > matrix.m22 && matrix.m11 > matrix.m33) {
		const scale = Math.sqrt(1 + matrix.m11 - matrix.m22 - matrix.m33) * 2;
		return normalizeQuaternion(
			new Quat(
				(matrix.m23 - matrix.m32) / scale,
				scale / 4,
				(matrix.m21 + matrix.m12) / scale,
				(matrix.m31 + matrix.m13) / scale,
			),
		);
	}
	if (matrix.m22 > matrix.m33) {
		const scale = Math.sqrt(1 + matrix.m22 - matrix.m11 - matrix.m33) * 2;
		return normalizeQuaternion(
			new Quat(
				(matrix.m31 - matrix.m13) / scale,
				(matrix.m21 + matrix.m12) / scale,
				scale / 4,
				(matrix.m32 + matrix.m23) / scale,
			),
		);
	}
	const scale = Math.sqrt(1 + matrix.m33 - matrix.m11 - matrix.m22) * 2;
	return normalizeQuaternion(
		new Quat(
			(matrix.m12 - matrix.m21) / scale,
			(matrix.m31 + matrix.m13) / scale,
			(matrix.m32 + matrix.m23) / scale,
			scale / 4,
		),
	);
}

function slerpQuaternion(from: Quat, to: Quat, fraction: number): Quat {
	let target = to;
	let dot = from.w * to.w + from.x * to.x + from.y * to.y + from.z * to.z;
	if (dot < 0) {
		dot = -dot;
		target = new Quat(-to.w, -to.x, -to.y, -to.z);
	}
	if (dot > 0.9995) {
		return normalizeQuaternion(
			new Quat(
				from.w + (target.w - from.w) * fraction,
				from.x + (target.x - from.x) * fraction,
				from.y + (target.y - from.y) * fraction,
				from.z + (target.z - from.z) * fraction,
			),
		);
	}
	const angle = Math.acos(Math.min(1, dot));
	const denominator = Math.sin(angle);
	const fromWeight = Math.sin((1 - fraction) * angle) / denominator;
	const toWeight = Math.sin(fraction * angle) / denominator;
	return new Quat(
		from.w * fromWeight + target.w * toWeight,
		from.x * fromWeight + target.x * toWeight,
		from.y * fromWeight + target.y * toWeight,
		from.z * fromWeight + target.z * toWeight,
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
