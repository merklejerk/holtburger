export const AC_UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;

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
): Float32Array {
	const rotation = buildAcRotationMatrix(placement.orientation);
	const scaleMatrix = createPlacementScaleMatrix(scale);
	const transform = multiplyMat4(rotation, scaleMatrix);
	transform[12] = placement.origin.x;
	transform[13] = placement.origin.z;
	transform[14] = -placement.origin.y;
	return transform;
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
): Float32Array {
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
