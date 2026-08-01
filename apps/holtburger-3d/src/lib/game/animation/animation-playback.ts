import type { PreparedAnimation } from "./animation-asset-repository";
import { createRotationMat4 } from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";

export type PlaybackDirection = "forward" | "backward";

/** Pure cyclic traversal result; hooks belong to departed frames, never interpolation endpoints. */
export interface CyclicFrameAdvance {
	readonly framePosition: number;
	readonly departedFrames: readonly number[];
}

/** Traverse one cyclic clip iteratively while preserving retail's seam-hook exclusions. */
export function advanceCyclicFrame(
	framePosition: number,
	elapsedFrames: number,
	frameCount: number,
	direction: PlaybackDirection,
): CyclicFrameAdvance {
	if (!Number.isFinite(framePosition) || !Number.isFinite(elapsedFrames))
		throw new Error("Animation frame traversal requires finite values.");
	if (!Number.isInteger(frameCount) || frameCount <= 0)
		throw new Error(
			"Animation frame traversal requires a positive frame count.",
		);
	if (elapsedFrames < 0)
		throw new Error("Animation frame traversal cannot consume negative time.");
	let position = modulo(framePosition, frameCount);
	let remaining = elapsedFrames;
	const departedFrames: number[] = [];
	while (remaining > 0) {
		if (direction === "forward") {
			const seamDistance = frameCount - position;
			const end =
				remaining >= seamDistance ? frameCount - 1 : position + remaining;
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
			position = 0;
		} else {
			if (remaining <= position) {
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
			for (let frame = Math.floor(position); frame > 0; frame -= 1)
				departedFrames.push(frame);
			remaining -= position;
			position = frameCount - 1;
		}
	}
	return { departedFrames, framePosition: position };
}

/** Sample frame-major rigid part poses without changing semantic frame or hook state. */
export function sampleAnimationPose(
	animation: PreparedAnimation,
	framePosition: number,
): readonly Mat4[] {
	const normalized = modulo(framePosition, animation.frameCount);
	const lowerFrame = Math.floor(normalized);
	// Part indices need not identify spatially continuous geometry across a cyclic seam.
	const upperFrame = Math.min(lowerFrame + 1, animation.frameCount - 1);
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

/** Retail `Frame::grotate` ignores committed rotation vectors below its authored epsilon. */
export function retailRotationVectorQuaternion(rotation: Vec3): Quat {
	return Math.hypot(rotation.x, rotation.y, rotation.z) < 0.0002
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
