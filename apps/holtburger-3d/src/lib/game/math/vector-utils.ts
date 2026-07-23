import { Vec3 } from "./types";

/** Return the vector from `right` to `left`. */
export function subtractVec3(left: Vec3, right: Vec3): Vec3 {
	return new Vec3(left.x - right.x, left.y - right.y, left.z - right.z);
}

/** Return one vector scaled by a scalar. */
export function scaleVec3(vector: Vec3, amount: number): Vec3 {
	return new Vec3(vector.x * amount, vector.y * amount, vector.z * amount);
}

/** Return the right-handed cross product of two vectors. */
export function crossVec3(left: Vec3, right: Vec3): Vec3 {
	return new Vec3(
		left.y * right.z - left.z * right.y,
		left.z * right.x - left.x * right.z,
		left.x * right.y - left.y * right.x,
	);
}

/** Return a unit vector, rejecting the undefined zero-vector direction. */
export function normalizeVec3(vector: Vec3): Vec3 {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) throw new Error("Cannot normalize a zero-length vector.");
	return scaleVec3(vector, 1 / length);
}

/** Constrain one scalar to its inclusive lower and upper bounds. */
export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
