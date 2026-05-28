import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import type { SceneCameraFrame } from "./camera";

export type LumaMat4 = Float32Array;
export type LumaVec4 = Float32Array;

function createIdentityMat4(): LumaMat4 {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function createTranslationMat4(offset: Vec3Dto): LumaMat4 {
	const matrix = createIdentityMat4();
	matrix[12] = offset.x;
	matrix[13] = offset.y;
	matrix[14] = offset.z;
	return matrix;
}

export function multiplyMat4(left: LumaMat4, right: LumaMat4): LumaMat4 {
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

export function buildSceneCameraViewProjectionMatrix(
	frame: SceneCameraFrame,
): LumaMat4 {
	return multiplyMat4(
		buildPerspectiveMatrix(frame),
		buildLookAtMatrix(frame.position, frame.target, frame.up),
	);
}

export function buildSceneCameraViewMatrix(frame: SceneCameraFrame): LumaMat4 {
	return buildLookAtMatrix(frame.position, frame.target, frame.up);
}

export function buildAcPlacementMatrix(
	placement: PlacementTransformDto,
	worldOffset: Vec3Dto,
	scale: Vec3Dto,
): LumaMat4 {
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

export function buildDebugColor(key: string): LumaVec4 {
	let hash = 0;
	for (let index = 0; index < key.length; index += 1) {
		hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
	}
	const [red, green, blue] = hslToRgb((hash % 360) / 360, 0.54, 0.48);
	return new Float32Array([red, green, blue, 1]);
}

function buildPerspectiveMatrix(frame: SceneCameraFrame): LumaMat4 {
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
): LumaMat4 {
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
): LumaMat4 {
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
}): LumaMat4 {
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
