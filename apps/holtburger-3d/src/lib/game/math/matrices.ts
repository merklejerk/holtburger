import { AABB3, Mat4, Quat, Vec3 } from "./types";

/** Compose column-major transforms for column-vector multiplication. */
export function multiplyMat4(left: Mat4, right: Mat4): Mat4 {
	const a = mat4Values(left);
	const b = mat4Values(right);
	const values = new Array<number>(16);
	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			let value = 0;
			for (let index = 0; index < 4; index += 1) {
				value += a[index * 4 + row]! * b[column * 4 + index]!;
			}
			values[column * 4 + row] = value;
		}
	}
	return mat4FromValues(values);
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

export function mat4ToFloat32Array(matrix: Mat4): Float32Array {
	return new Float32Array(mat4Values(matrix));
}

export function getMat4Translation(matrix: Mat4): Vec3 {
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
export function transformAABB3(matrix: Mat4, bounds: AABB3): AABB3 {
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
	return new AABB3(
		new Vec3(
			Math.min(...corners.map((corner) => corner.x)),
			Math.min(...corners.map((corner) => corner.y)),
			Math.min(...corners.map((corner) => corner.z)),
		),
		new Vec3(
			Math.max(...corners.map((corner) => corner.x)),
			Math.max(...corners.map((corner) => corner.y)),
			Math.max(...corners.map((corner) => corner.z)),
		),
	);
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

function mat4Values(matrix: Mat4): readonly number[] {
	return [
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
}

function mat4FromValues(values: readonly number[]): Mat4 {
	if (values.length !== 16) throw new Error("A matrix requires 16 values.");
	return new Mat4(
		values[0]!,
		values[1]!,
		values[2]!,
		values[3]!,
		values[4]!,
		values[5]!,
		values[6]!,
		values[7]!,
		values[8]!,
		values[9]!,
		values[10]!,
		values[11]!,
		values[12]!,
		values[13]!,
		values[14]!,
		values[15]!,
	);
}
