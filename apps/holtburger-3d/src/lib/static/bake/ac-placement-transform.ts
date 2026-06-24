export const AC_UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;
export type RenderMat4 = Float32Array;

export interface AcPlacementTransform {
	readonly origin: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly orientation: {
		readonly w: number;
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
}

export interface AcPlacementScale {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export function buildAcPlacementMatrix(
	placement: AcPlacementTransform,
	scale: AcPlacementScale,
): RenderMat4 {
	const rotation = buildAcRotationMatrix(placement.orientation);
	const scaleMatrix = createPlacementScaleMatrix(scale);
	const transform = multiplyMat4(rotation, scaleMatrix);
	transform[12] = placement.origin.x;
	transform[13] = placement.origin.z;
	transform[14] = -placement.origin.y;
	return transform;
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

	const inverseDeterminant = 1 / determinant;
	return new Float32Array([
		(a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant,
		(a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant,
		(a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant,
		(a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant,
		(a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant,
		(a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant,
		(a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant,
		(a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant,
		(a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant,
		(a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant,
		(a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant,
		(a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant,
		(a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant,
		(a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant,
		(a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant,
		(a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant,
	]);
}

export function transformPointByMat4(
	point: { readonly x: number; readonly y: number; readonly z: number },
	matrix: RenderMat4,
): { readonly x: number; readonly y: number; readonly z: number } {
	const x = point.x;
	const y = point.y;
	const z = point.z;
	const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
	const inverseW = w === 0 ? 1 : 1 / w;
	return {
		x: (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * inverseW,
		y: (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * inverseW,
		z: (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * inverseW,
	};
}

export function writeTransformedPosition(options: {
	readonly source: Float32Array;
	readonly positions: Float32Array;
	readonly matrix: Float32Array;
	readonly sourceVertexIndex: number;
	readonly targetVertexIndex: number;
}): void {
	const sourceOffset = options.sourceVertexIndex * 3;
	const x = options.source[sourceOffset] ?? 0;
	const y = options.source[sourceOffset + 1] ?? 0;
	const z = options.source[sourceOffset + 2] ?? 0;
	const targetOffset = options.targetVertexIndex * 3;

	options.positions[targetOffset] =
		options.matrix[0] * x +
		options.matrix[4] * y +
		options.matrix[8] * z +
		options.matrix[12];
	options.positions[targetOffset + 1] =
		options.matrix[1] * x +
		options.matrix[5] * y +
		options.matrix[9] * z +
		options.matrix[13];
	options.positions[targetOffset + 2] =
		options.matrix[2] * x +
		options.matrix[6] * y +
		options.matrix[10] * z +
		options.matrix[14];
}

export function writeTexCoord(options: {
	readonly source: Float32Array;
	readonly target: Float32Array;
	readonly sourceVertexIndex: number;
	readonly targetVertexIndex: number;
}): void {
	const sourceOffset = options.sourceVertexIndex * 2;
	const targetOffset = options.targetVertexIndex * 2;
	options.target[targetOffset] = options.source[sourceOffset] ?? 0;
	options.target[targetOffset + 1] = options.source[sourceOffset + 1] ?? 0;
}

export function createStaticObjectSourceScaleMatrix(
	scale: AcPlacementScale,
): Float32Array {
	return new Float32Array([
		scale.x,
		0,
		0,
		0,
		0,
		scale.z,
		0,
		0,
		0,
		0,
		scale.y,
		0,
		0,
		0,
		0,
		1,
	]);
}

export function multiplyMat4(
	left: Float32Array,
	right: Float32Array,
): RenderMat4 {
	const result = new Float32Array(16);

	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			result[column * 4 + row] =
				left[0 * 4 + row] * right[column * 4 + 0] +
				left[1 * 4 + row] * right[column * 4 + 1] +
				left[2 * 4 + row] * right[column * 4 + 2] +
				left[3 * 4 + row] * right[column * 4 + 3];
		}
	}

	return result;
}

function buildAcRotationMatrix(quaternion: {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): Float32Array {
	const acRotation = buildQuaternionRotationMatrix(quaternion);
	const acToRender = new Float32Array([
		1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
	]);
	const renderToAc = new Float32Array([
		1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1,
	]);
	return multiplyMat4(multiplyMat4(acToRender, acRotation), renderToAc);
}

function buildQuaternionRotationMatrix(quaternion: {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly w: number;
}): Float32Array {
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

function createPlacementScaleMatrix(scale: AcPlacementScale): Float32Array {
	return new Float32Array([
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
}
