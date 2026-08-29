import { AABB3, Mat4, Quat, Vec3 } from "./types";

/** Compose column-major transforms for column-vector multiplication. */
export function multiplyMat4(
	left: Mat4,
	right: Mat4,
	targetMatrix?: Mat4,
): Mat4 {
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

	const target = targetMatrix ?? Mat4.zero();
	target.m11 = a11 * b11 + a21 * b12 + a31 * b13 + a41 * b14;
	target.m12 = a12 * b11 + a22 * b12 + a32 * b13 + a42 * b14;
	target.m13 = a13 * b11 + a23 * b12 + a33 * b13 + a43 * b14;
	target.m14 = a14 * b11 + a24 * b12 + a34 * b13 + a44 * b14;
	target.m21 = a11 * b21 + a21 * b22 + a31 * b23 + a41 * b24;
	target.m22 = a12 * b21 + a22 * b22 + a32 * b23 + a42 * b24;
	target.m23 = a13 * b21 + a23 * b22 + a33 * b23 + a43 * b24;
	target.m24 = a14 * b21 + a24 * b22 + a34 * b23 + a44 * b24;
	target.m31 = a11 * b31 + a21 * b32 + a31 * b33 + a41 * b34;
	target.m32 = a12 * b31 + a22 * b32 + a32 * b33 + a42 * b34;
	target.m33 = a13 * b31 + a23 * b32 + a33 * b33 + a43 * b34;
	target.m34 = a14 * b31 + a24 * b32 + a34 * b33 + a44 * b34;
	target.m41 = a11 * b41 + a21 * b42 + a31 * b43 + a41 * b44;
	target.m42 = a12 * b41 + a22 * b42 + a32 * b43 + a42 * b44;
	target.m43 = a13 * b41 + a23 * b42 + a33 * b43 + a43 * b44;
	target.m44 = a14 * b41 + a24 * b42 + a34 * b43 + a44 * b44;
	return target;
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

/** Create a non-uniform scale matrix, optionally reusing caller-owned storage. */
export function createScaleMat4(scale: Vec3, targetMatrix?: Mat4): Mat4 {
	const target = targetMatrix ?? Mat4.zero();
	target.m11 = scale.x;
	target.m12 = 0;
	target.m13 = 0;
	target.m14 = 0;
	target.m21 = 0;
	target.m22 = scale.y;
	target.m23 = 0;
	target.m24 = 0;
	target.m31 = 0;
	target.m32 = 0;
	target.m33 = scale.z;
	target.m34 = 0;
	target.m41 = 0;
	target.m42 = 0;
	target.m43 = 0;
	target.m44 = 1;
	return target;
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

/** Create a right-handed WebGL orthographic projection. */
export function createOrthographicMat4(
	left: number,
	right: number,
	bottom: number,
	top: number,
	near: number,
	far: number,
	targetMatrix?: Mat4,
): Mat4 {
	if (![left, right, bottom, top, near, far].every(Number.isFinite)) {
		throw new Error("Orthographic projection bounds must be finite.");
	}
	if (right <= left || top <= bottom) {
		throw new Error("Orthographic projection extents must be non-empty.");
	}
	if (near < 0 || far <= near) {
		throw new Error(
			"Orthographic projection depth requires zero or positive near and far greater than near.",
		);
	}
	const inverseWidth = 1 / (right - left);
	const inverseHeight = 1 / (top - bottom);
	const inverseDepth = 1 / (far - near);
	const target = targetMatrix ?? Mat4.zero();
	target.m11 = 2 * inverseWidth;
	target.m12 = 0;
	target.m13 = 0;
	target.m14 = 0;
	target.m21 = 0;
	target.m22 = 2 * inverseHeight;
	target.m23 = 0;
	target.m24 = 0;
	target.m31 = 0;
	target.m32 = 0;
	target.m33 = -2 * inverseDepth;
	target.m34 = 0;
	target.m41 = -(right + left) * inverseWidth;
	target.m42 = -(top + bottom) * inverseHeight;
	target.m43 = -(far + near) * inverseDepth;
	target.m44 = 1;
	return target;
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
	writeMat4ToFloat32Array(matrix, out, 0);
	return out;
}

/** Write one matrix into caller-owned float storage at an explicit element offset. */
export function writeMat4ToFloat32Array(
	matrix: Mat4,
	out: Float32Array,
	firstElement: number,
): void {
	out[firstElement] = matrix.m11;
	out[firstElement + 1] = matrix.m12;
	out[firstElement + 2] = matrix.m13;
	out[firstElement + 3] = matrix.m14;
	out[firstElement + 4] = matrix.m21;
	out[firstElement + 5] = matrix.m22;
	out[firstElement + 6] = matrix.m23;
	out[firstElement + 7] = matrix.m24;
	out[firstElement + 8] = matrix.m31;
	out[firstElement + 9] = matrix.m32;
	out[firstElement + 10] = matrix.m33;
	out[firstElement + 11] = matrix.m34;
	out[firstElement + 12] = matrix.m41;
	out[firstElement + 13] = matrix.m42;
	out[firstElement + 14] = matrix.m43;
	out[firstElement + 15] = matrix.m44;
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

/** Transform one point by a column-major matrix, optionally reusing caller-owned storage. */
export function transformPoint3(
	matrix: Mat4,
	point: Vec3,
	targetVec?: Vec3,
): Vec3 {
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
	const target = targetVec ?? Vec3.zero();
	target.x = x / w;
	target.y = y / w;
	target.z = z / w;
	return target;
}

/**
 * Transform a point through the inverse of a rotation-plus-translation matrix.
 *
 * This rejects scale, shear, and projective terms instead of silently treating every affine
 * transform as rigid.
 */
export function inverseTransformRigidPoint3(
	matrix: Mat4,
	point: Vec3,
	targetVec?: Vec3,
): Vec3 {
	assertRigidTransform(matrix);
	const x = point.x - matrix.m41;
	const y = point.y - matrix.m42;
	const z = point.z - matrix.m43;
	const target = targetVec ?? Vec3.zero();
	target.x = matrix.m11 * x + matrix.m12 * y + matrix.m13 * z;
	target.y = matrix.m21 * x + matrix.m22 * y + matrix.m23 * z;
	target.z = matrix.m31 * x + matrix.m32 * y + matrix.m33 * z;
	return target;
}

function assertRigidTransform(matrix: Mat4): void {
	const values = [
		matrix.m11,
		matrix.m12,
		matrix.m13,
		matrix.m14,
		matrix.m21,
		matrix.m22,
		matrix.m23,
		matrix.m24,
		matrix.m31,
		matrix.m32,
		matrix.m33,
		matrix.m34,
		matrix.m41,
		matrix.m42,
		matrix.m43,
		matrix.m44,
	];
	if (!values.every(Number.isFinite)) {
		throw new Error("Rigid transform contains non-finite values.");
	}
	const tolerance = 0.000_01;
	const lengthSquared = (x: number, y: number, z: number): number =>
		x * x + y * y + z * z;
	const dot = (
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
	): number => ax * bx + ay * by + az * bz;
	const affine =
		Math.abs(matrix.m14) <= tolerance &&
		Math.abs(matrix.m24) <= tolerance &&
		Math.abs(matrix.m34) <= tolerance &&
		Math.abs(matrix.m44 - 1) <= tolerance;
	const unitColumns =
		Math.abs(lengthSquared(matrix.m11, matrix.m12, matrix.m13) - 1) <=
			tolerance &&
		Math.abs(lengthSquared(matrix.m21, matrix.m22, matrix.m23) - 1) <=
			tolerance &&
		Math.abs(lengthSquared(matrix.m31, matrix.m32, matrix.m33) - 1) <=
			tolerance;
	const orthogonalColumns =
		Math.abs(
			dot(
				matrix.m11,
				matrix.m12,
				matrix.m13,
				matrix.m21,
				matrix.m22,
				matrix.m23,
			),
		) <= tolerance &&
		Math.abs(
			dot(
				matrix.m11,
				matrix.m12,
				matrix.m13,
				matrix.m31,
				matrix.m32,
				matrix.m33,
			),
		) <= tolerance &&
		Math.abs(
			dot(
				matrix.m21,
				matrix.m22,
				matrix.m23,
				matrix.m31,
				matrix.m32,
				matrix.m33,
			),
		) <= tolerance;
	if (!affine || !unitColumns || !orthogonalColumns) {
		throw new Error("Point inverse requires a rigid rotation and translation.");
	}
}

/**
 * Transform a normal by the inverse transpose of a matrix's upper-left 3×3 portion.
 *
 * A singular transform has no valid normal transform. Zero normals are preserved because DAT
 * geometry may intentionally contain them.
 */
export function transformNormal3(
	matrix: Mat4,
	normal: Vec3,
	targetVec?: Vec3,
): Vec3 {
	const a = matrix.m11;
	const b = matrix.m21;
	const c = matrix.m31;
	const d = matrix.m12;
	const e = matrix.m22;
	const f = matrix.m32;
	const g = matrix.m13;
	const h = matrix.m23;
	const i = matrix.m33;
	const determinant =
		a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if (!Number.isFinite(determinant) || determinant === 0) {
		throw new Error("Cannot transform a normal through a singular matrix.");
	}
	const x =
		((e * i - f * h) * normal.x +
			(f * g - d * i) * normal.y +
			(d * h - e * g) * normal.z) /
		determinant;
	const y =
		((c * h - b * i) * normal.x +
			(a * i - c * g) * normal.y +
			(b * g - a * h) * normal.z) /
		determinant;
	const z =
		((b * f - c * e) * normal.x +
			(c * d - a * f) * normal.y +
			(a * e - b * d) * normal.z) /
		determinant;
	const magnitude = Math.hypot(x, y, z);
	if (!Number.isFinite(magnitude)) {
		throw new Error("Cannot transform a non-finite normal.");
	}
	const target = targetVec ?? Vec3.zero();
	if (magnitude === 0) {
		target.x = 0;
		target.y = 0;
		target.z = 0;
		return target;
	}
	target.x = x / magnitude;
	target.y = y / magnitude;
	target.z = z / magnitude;
	return target;
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

/** Create a rigid rotation matrix from a normalized quaternion. */
export function createRotationMat4(rotation: Quat): Mat4 {
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
