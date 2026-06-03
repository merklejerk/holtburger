import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import type { SceneCameraFrame } from "./camera";

export type RenderMat4 = Float32Array;
export type RenderVec4 = Float32Array;

function createIdentityMat4(): RenderMat4 {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function createTranslationMat4(offset: Vec3Dto): RenderMat4 {
	const matrix = createIdentityMat4();
	matrix[12] = offset.x;
	matrix[13] = offset.y;
	matrix[14] = offset.z;
	return matrix;
}

export function multiplyMat4(left: RenderMat4, right: RenderMat4): RenderMat4 {
	const output = new Float32Array(16);
	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			output[column * 4 + row] =
				left[row] * right[column * 4] +
				left[4 + row] * right[column * 4 + 1] +
				left[8 + row] * right[column * 4 + 2] +
				left[12 + row] * right[column * 4 + 3];
		}
	}
	return output;
}

export function invertMat4(matrix: RenderMat4): RenderMat4 {
	const a00 = matrix[0];
	const a01 = matrix[1];
	const a02 = matrix[2];
	const a03 = matrix[3];
	const a10 = matrix[4];
	const a11 = matrix[5];
	const a12 = matrix[6];
	const a13 = matrix[7];
	const a20 = matrix[8];
	const a21 = matrix[9];
	const a22 = matrix[10];
	const a23 = matrix[11];
	const a30 = matrix[12];
	const a31 = matrix[13];
	const a32 = matrix[14];
	const a33 = matrix[15];

	const b00 = a00 * a11 - a01 * a10;
	const b01 = a00 * a12 - a02 * a10;
	const b02 = a00 * a13 - a03 * a10;
	const b03 = a01 * a12 - a02 * a11;
	const b04 = a01 * a13 - a03 * a11;
	const b05 = a02 * a13 - a03 * a12;
	const b06 = a20 * a31 - a21 * a30;
	const b07 = a20 * a32 - a22 * a30;
	const b08 = a20 * a33 - a23 * a30;
	const b09 = a21 * a32 - a22 * a31;
	const b10 = a21 * a33 - a23 * a31;
	const b11 = a22 * a33 - a23 * a32;
	const determinant =
		b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (determinant === 0) {
		throw new Error("Cannot invert a singular render matrix.");
	}
	const invDeterminant = 1 / determinant;
	return new Float32Array([
		(a11 * b11 - a12 * b10 + a13 * b09) * invDeterminant,
		(a02 * b10 - a01 * b11 - a03 * b09) * invDeterminant,
		(a31 * b05 - a32 * b04 + a33 * b03) * invDeterminant,
		(a22 * b04 - a21 * b05 - a23 * b03) * invDeterminant,
		(a12 * b08 - a10 * b11 - a13 * b07) * invDeterminant,
		(a00 * b11 - a02 * b08 + a03 * b07) * invDeterminant,
		(a32 * b02 - a30 * b05 - a33 * b01) * invDeterminant,
		(a20 * b05 - a22 * b02 + a23 * b01) * invDeterminant,
		(a10 * b10 - a11 * b08 + a13 * b06) * invDeterminant,
		(a01 * b08 - a00 * b10 - a03 * b06) * invDeterminant,
		(a30 * b04 - a31 * b02 + a33 * b00) * invDeterminant,
		(a21 * b02 - a20 * b04 - a23 * b00) * invDeterminant,
		(a11 * b07 - a10 * b09 - a12 * b06) * invDeterminant,
		(a00 * b09 - a01 * b07 + a02 * b06) * invDeterminant,
		(a31 * b01 - a30 * b03 - a32 * b00) * invDeterminant,
		(a20 * b03 - a21 * b01 + a22 * b00) * invDeterminant,
	]);
}

export function transformPointByMat4(
	point: Vec3Dto,
	matrix: RenderMat4,
): Vec3Dto {
	return {
		x:
			matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12],
		y:
			matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13],
		z:
			matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14],
	};
}

export function buildSceneCameraViewProjectionMatrix(
	frame: SceneCameraFrame,
): RenderMat4 {
	return multiplyMat4(
		buildPerspectiveMatrix(frame),
		buildLookAtMatrix(frame.position, frame.target, frame.up),
	);
}

export function buildSceneCameraViewMatrix(
	frame: SceneCameraFrame,
): RenderMat4 {
	return buildLookAtMatrix(frame.position, frame.target, frame.up);
}

export function buildAcPlacementMatrix(
	placement: PlacementTransformDto,
	worldOffset: Vec3Dto,
	scale: Vec3Dto,
): RenderMat4 {
	const rotation = buildAcRotationMatrix(placement.orientation);
	const scaleMatrix = new Float32Array([
		scale.x,
		0,
		0,
		0,
		0,
		scale.y,
		0,
		0,
		0,
		0,
		scale.z,
		0,
		0,
		0,
		0,
		1,
	]);
	const transform = multiplyMat4(rotation, scaleMatrix);
	transform[12] = placement.origin.x + worldOffset.x;
	transform[13] = placement.origin.z + worldOffset.z;
	transform[14] = -(placement.origin.y + worldOffset.y);
	return transform;
}

export function buildDebugColor(key: string): RenderVec4 {
	let hash = 0;
	for (let index = 0; index < key.length; index += 1) {
		hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
	}
	const [red, green, blue] = hslToRgb((hash % 360) / 360, 0.54, 0.48);
	return new Float32Array([red, green, blue, 1]);
}

function buildPerspectiveMatrix(frame: SceneCameraFrame): RenderMat4 {
	const fovRadians = (frame.fovDegrees * Math.PI) / 180;
	const f = 1 / Math.tan(fovRadians / 2);
	const nearMinusFar = frame.near - frame.far;

	return new Float32Array([
		f / frame.aspect,
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		(frame.far + frame.near) / nearMinusFar,
		-1,
		0,
		0,
		(2 * frame.far * frame.near) / nearMinusFar,
		0,
	]);
}

function buildLookAtMatrix(
	position: Vec3Dto,
	target: Vec3Dto,
	up: Vec3Dto,
): RenderMat4 {
	const zAxis = normalizeVec3(subtractVec3(position, target));
	const xAxis = normalizeVec3(crossVec3(up, zAxis));
	const yAxis = crossVec3(zAxis, xAxis);

	return new Float32Array([
		xAxis.x,
		yAxis.x,
		zAxis.x,
		0,
		xAxis.y,
		yAxis.y,
		zAxis.y,
		0,
		xAxis.z,
		yAxis.z,
		zAxis.z,
		0,
		-dotVec3(xAxis, position),
		-dotVec3(yAxis, position),
		-dotVec3(zAxis, position),
		1,
	]);
}

function buildAcRotationMatrix(
	quaternion: PlacementTransformDto["orientation"],
): RenderMat4 {
	const acRotation = buildQuaternionRotationMatrix({
		x: quaternion.x,
		y: quaternion.y,
		z: quaternion.z,
		w: quaternion.w,
	});
	const acToRender = new Float32Array([
		1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
	]);
	const renderToAc = new Float32Array([
		1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1,
	]);
	return multiplyMat4(multiplyMat4(acToRender, acRotation), renderToAc);
}

function buildQuaternionRotationMatrix(quaternion: {
	x: number;
	y: number;
	z: number;
	w: number;
}): RenderMat4 {
	const { x, y, z, w } = quaternion;
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;

	return new Float32Array([
		1 - (yy + zz),
		xy + wz,
		xz - wy,
		0,
		xy - wz,
		1 - (xx + zz),
		yz + wx,
		0,
		xz + wy,
		yz - wx,
		1 - (xx + yy),
		0,
		0,
		0,
		0,
		1,
	]);
}

function subtractVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function crossVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function dotVec3(left: Vec3Dto, right: Vec3Dto): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function normalizeVec3(vector: Vec3Dto): Vec3Dto {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return { x: 0, y: 0, z: 0 };
	}
	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const huePrime = hue * 6;
	const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
	const [red1, green1, blue1] =
		huePrime < 1
			? [chroma, x, 0]
			: huePrime < 2
				? [x, chroma, 0]
				: huePrime < 3
					? [0, chroma, x]
					: huePrime < 4
						? [0, x, chroma]
						: huePrime < 5
							? [x, 0, chroma]
							: [chroma, 0, x];
	const m = lightness - chroma / 2;
	return [red1 + m, green1 + m, blue1 + m];
}
