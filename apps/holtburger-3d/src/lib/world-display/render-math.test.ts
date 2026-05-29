import { describe, expect, it } from "vitest";

import {
	buildAcPlacementMatrix,
	buildSceneCameraViewMatrix,
	createTranslationMat4,
	multiplyMat4,
} from "./render-math";

describe("multiplyMat4", () => {
	it("composes column-major translations", () => {
		const matrix = multiplyMat4(
			createTranslationMat4({ x: 10, y: 20, z: 30 }),
			createTranslationMat4({ x: 1, y: 2, z: 3 }),
		);

		expect(matrix[12]).toBe(11);
		expect(matrix[13]).toBe(22);
		expect(matrix[14]).toBe(33);
	});
});

describe("buildAcPlacementMatrix", () => {
	it("maps AC placement origin into render-space coordinates", () => {
		const matrix = buildAcPlacementMatrix(
			{
				origin: { x: 1, y: 2, z: 3 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			{ x: 10, y: 20, z: 30 },
			{ x: 1, y: 1, z: 1 },
		);

		expect(matrix[12]).toBe(11);
		expect(matrix[13]).toBe(33);
		expect(matrix[14]).toBe(-22);
	});
});

describe("buildSceneCameraViewMatrix", () => {
	it("keeps camera-space origin on the negative z axis for a look-at target", () => {
		const matrix = buildSceneCameraViewMatrix({
			position: { x: 0, y: 120, z: 180 },
			target: { x: 0, y: 0, z: 0 },
			up: { x: 0, y: 1, z: 0 },
			aspect: 1,
			fovDegrees: 52,
			near: 0.1,
			far: 5000,
		});

		const transformedOrigin = transformPoint(matrix, [0, 0, 0, 1]);

		expect(transformedOrigin[0]).toBeCloseTo(0);
		expect(transformedOrigin[1]).toBeCloseTo(0);
		expect(transformedOrigin[2]).toBeLessThan(0);
	});
});

function transformPoint(
	matrix: Float32Array,
	point: [number, number, number, number],
): [number, number, number, number] {
	return [
		matrix[0] * point[0] +
			matrix[4] * point[1] +
			matrix[8] * point[2] +
			matrix[12] * point[3],
		matrix[1] * point[0] +
			matrix[5] * point[1] +
			matrix[9] * point[2] +
			matrix[13] * point[3],
		matrix[2] * point[0] +
			matrix[6] * point[1] +
			matrix[10] * point[2] +
			matrix[14] * point[3],
		matrix[3] * point[0] +
			matrix[7] * point[1] +
			matrix[11] * point[2] +
			matrix[15] * point[3],
	];
}
