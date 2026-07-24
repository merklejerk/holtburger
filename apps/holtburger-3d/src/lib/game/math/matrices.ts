import { AABB3, Mat4, Quat, Vec3 } from "./types";

/** Compose column-major transforms for column-vector multiplication. */
export function multiplyMat4(left: Mat4, right: Mat4): Mat4 {
	const a11 = left.m11,
		a12 = left.m12,
		a13 = left.m13,
		a14 = left.m14;
	const a21 = left.m21,
		a22 = left.m22,
		a23 = left.m23,
		a24 = left.m24;
	const a31 = left.m31,
		a32 = left.m32,
		a33 = left.m33,
		a34 = left.m34;
	const a41 = left.m41,
		a42 = left.m42,
		a43 = left.m43,
		a44 = left.m44;

	const b11 = right.m11,
		b12 = right.m12,
		b13 = right.m13,
		b14 = right.m14;
	const b21 = right.m21,
		b22 = right.m22,
		b23 = right.m23,
		b24 = right.m24;
	const b31 = right.m31,
		b32 = right.m32,
		b33 = right.m33,
		b34 = right.m34;
	const b41 = right.m41,
		b42 = right.m42,
		b43 = right.m43,
		b44 = right.m44;

	return new Mat4(
		a11 * b11 + a21 * b12 + a31 * b13 + a41 * b14,
		a12 * b11 + a22 * b12 + a32 * b13 + a42 * b14,
		a13 * b11 + a23 * b12 + a33 * b13 + a43 * b14,
		a14 * b11 + a24 * b12 + a34 * b13 + a44 * b14,

		a11 * b21 + a21 * b22 + a31 * b23 + a41 * b24,
		a12 * b21 + a22 * b22 + a32 * b23 + a42 * b24,
		a13 * b21 + a23 * b22 + a33 * b23 + a43 * b24,
		a14 * b21 + a24 * b22 + a34 * b23 + a44 * b24,

		a11 * b31 + a21 * b32 + a31 * b33 + a41 * b34,
		a12 * b31 + a22 * b32 + a32 * b33 + a42 * b34,
		a13 * b31 + a23 * b32 + a33 * b33 + a43 * b34,
		a14 * b31 + a24 * b32 + a34 * b33 + a44 * b34,

		a11 * b41 + a21 * b42 + a31 * b43 + a41 * b44,
		a12 * b41 + a22 * b42 + a32 * b43 + a42 * b44,
		a13 * b41 + a23 * b42 + a33 * b43 + a43 * b44,
		a14 * b41 + a24 * b42 + a34 * b43 + a44 * b44,
	);
}

export function createTranslationMat4(translation: Vec3): Mat4 {
	return new Mat4(
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		translation.x,
		translation.y,
		translation.z,
		1,
	);
}

/** Create a right-handed WebGL perspective projection. */
export function createPerspectiveMat4(
	fovDegrees: number,
	aspectRatio: number,
	near: number,
	far: number,
): Mat4 {
	if (fovDegrees <= 0 || fovDegrees >= 180) {
		throw new Error("Camera field of view must be between 0 and 180 degrees.");
	}
	if (aspectRatio <= 0 || near <= 0 || far <= near) {
		throw new Error("Invalid camera projection dimensions.");
	}
	const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
	const rangeInverse = 1 / (near - far);
	return new Mat4(
		f / aspectRatio,
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		(near + far) * rangeInverse,
		-1,
		0,
		0,
		2 * near * far * rangeInverse,
		0,
	);
}

/** Invert a camera-local rotation and translation into a view matrix. */
export function createViewMat4(position: Vec3, rotation: Quat): Mat4 {
	const inverseRotation = createRotationMat4(
		normalizeQuat(new Quat(rotation.w, -rotation.x, -rotation.y, -rotation.z)),
	);
	return multiplyMat4(
		inverseRotation,
		createTranslationMat4(new Vec3(-position.x, -position.y, -position.z)),
	);
}

export function mat4ToFloat32Array(
	matrix: Mat4,
	outBuffer?: Float32Array,
): Float32Array {
	const out = outBuffer ?? new Float32Array(16);
	out[0] = matrix.m11;
	out[1] = matrix.m12;
	out[2] = matrix.m13;
	out[3] = matrix.m14;
	out[4] = matrix.m21;
	out[5] = matrix.m22;
	out[6] = matrix.m23;
	out[7] = matrix.m24;
	out[8] = matrix.m31;
	out[9] = matrix.m32;
	out[10] = matrix.m33;
	out[11] = matrix.m34;
	out[12] = matrix.m41;
	out[13] = matrix.m42;
	out[14] = matrix.m43;
	out[15] = matrix.m44;
	return out;
}

export function getMat4Translation(matrix: Mat4, targetVec?: Vec3): Vec3 {
	if (targetVec) {
		targetVec.x = matrix.m41;
		targetVec.y = matrix.m42;
		targetVec.z = matrix.m43;
		return targetVec;
	}
	return new Vec3(matrix.m41, matrix.m42, matrix.m43);
}

/** Transform one point by a column-major matrix. */
export function transformPoint3(matrix: Mat4, point: Vec3): Vec3 {
	const x =
		matrix.m11 * point.x +
		matrix.m21 * point.y +
		matrix.m31 * point.z +
		matrix.m41;
	const y =
		matrix.m12 * point.x +
		matrix.m22 * point.y +
		matrix.m32 * point.z +
		matrix.m42;
	const z =
		matrix.m13 * point.x +
		matrix.m23 * point.y +
		matrix.m33 * point.z +
		matrix.m43;
	const w =
		matrix.m14 * point.x +
		matrix.m24 * point.y +
		matrix.m34 * point.z +
		matrix.m44;
	if (w === 0) throw new Error("Cannot transform a point with zero W.");
	return new Vec3(x / w, y / w, z / w);
}

/** Return the conservative axis-aligned bounds of one transformed local-space box. */
export function transformAABB3(
	matrix: Mat4,
	bounds: AABB3,
	targetBounds?: AABB3,
): AABB3 {
	const corners = [
		new Vec3(bounds.min.x, bounds.min.y, bounds.min.z),
		new Vec3(bounds.min.x, bounds.min.y, bounds.max.z),
		new Vec3(bounds.min.x, bounds.max.y, bounds.min.z),
		new Vec3(bounds.min.x, bounds.max.y, bounds.max.z),
		new Vec3(bounds.max.x, bounds.min.y, bounds.min.z),
		new Vec3(bounds.max.x, bounds.min.y, bounds.max.z),
		new Vec3(bounds.max.x, bounds.max.y, bounds.min.z),
		new Vec3(bounds.max.x, bounds.max.y, bounds.max.z),
	].map((corner) => transformPoint3(matrix, corner));
	const target = targetBounds ?? AABB3.zero();
	target.min.x = Math.min(...corners.map((corner) => corner.x));
	target.min.y = Math.min(...corners.map((corner) => corner.y));
	target.min.z = Math.min(...corners.map((corner) => corner.z));
	target.max.x = Math.max(...corners.map((corner) => corner.x));
	target.max.y = Math.max(...corners.map((corner) => corner.y));
	target.max.z = Math.max(...corners.map((corner) => corner.z));
	return target;
}

function createRotationMat4(rotation: Quat): Mat4 {
	const { w, x, y, z } = rotation;
	return new Mat4(
		1 - 2 * (y * y + z * z),
		2 * (x * y + w * z),
		2 * (x * z - w * y),
		0,
		2 * (x * y - w * z),
		1 - 2 * (x * x + z * z),
		2 * (y * z + w * x),
		0,
		2 * (x * z + w * y),
		2 * (y * z - w * x),
		1 - 2 * (x * x + y * y),
		0,
		0,
		0,
		0,
		1,
	);
}

function normalizeQuat(rotation: Quat): Quat {
	const magnitude = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	if (magnitude === 0) throw new Error("Camera rotation cannot be zero.");
	return new Quat(
		rotation.w / magnitude,
		rotation.x / magnitude,
		rotation.y / magnitude,
		rotation.z / magnitude,
	);
}
