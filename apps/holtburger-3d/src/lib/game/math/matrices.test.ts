import { describe, expect, it } from "vitest";
import {
	createOrthographicMat4,
	createScaleMat4,
	createTranslationMat4,
	createViewMat4,
	getMat4Translation,
	inverseTransformRigidPoint3,
	multiplyMat4,
	transformNormal3,
	transformPoint3,
	transformAABB3,
	transformAffineAABB3,
	writeMat4ToFloat32Array,
} from "./matrices";
import { AABB3, Mat4, Quat, Vec3 } from "./types";

describe("matrix composition", () => {
	it("matches corner bounds for affine bases and supports aliased output", () => {
		// Exercise mixed bases (including shear/reflection) and translated, non-centered boxes.
		for (let index = 0; index < 100; index += 1) {
			const matrix = new Mat4(
				Math.sin(index),
				Math.cos(index),
				-0.5,
				0,
				-2,
				Math.sin(index * 2),
				Math.cos(index * 3),
				0,
				Math.cos(index * 2),
				0.75,
				Math.sin(index * 3),
				0,
				index - 50,
				3,
				-17,
				1,
			);
			const bounds = new AABB3(new Vec3(-3, 1, -7), new Vec3(2, 4, 5));
			const expected = transformAABB3(matrix, bounds);
			expect(transformAffineAABB3(matrix, bounds, bounds)).toBe(bounds);
			for (const corner of ["min", "max"] as const)
				for (const axis of ["x", "y", "z"] as const)
					expect(bounds[corner][axis]).toBeCloseTo(expected[corner][axis], 10);
		}
	});

	it("transforms point bounds and collapsed axes", () => {
		const matrix = createScaleMat4(new Vec3(0, -2, 3));
		const point = new AABB3(new Vec3(1, 2, 3), new Vec3(1, 2, 3));
		const output = AABB3.zero();
		expect(transformAffineAABB3(matrix, point, output)).toBe(output);
		expect(output).toEqual(transformAABB3(matrix, point));
	});

	it.each(["m14", "m24", "m34", "m44"] as const)(
		"rejects a non-affine %s before mutating output",
		(field) => {
			const matrix = Mat4.identity();
			matrix[field] = 0.5;
			const bounds = new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6));
			const previous = bounds.clone();
			expect(() => transformAffineAABB3(matrix, bounds, bounds)).toThrow(
				"affine transform",
			);
			expect(bounds).toEqual(previous);
		},
	);

	it("maps an orthographic box onto the WebGL clip cube", () => {
		const storage = Mat4.zero();
		const projection = createOrthographicMat4(-2, 6, -4, 2, 3, 11, storage);
		expect(projection).toBe(storage);
		expect(transformPoint3(projection, new Vec3(-2, -4, -3))).toEqual(
			new Vec3(-1, -1, -1),
		);
		expect(transformPoint3(projection, new Vec3(6, 2, -11))).toEqual(
			new Vec3(1, 1, 1),
		);
	});

	it("rejects malformed orthographic bounds", () => {
		expect(() => createOrthographicMat4(0, Number.NaN, -1, 1, 0, 1)).toThrow(
			"must be finite",
		);
		expect(() => createOrthographicMat4(1, 1, -1, 1, 0, 1)).toThrow(
			"extents must be non-empty",
		);
		expect(() => createOrthographicMat4(-1, 1, -1, 1, -1, 1)).toThrow(
			"zero or positive near",
		);
	});

	it("composes child translations into their parent coordinate frame", () => {
		const parent = createTranslationMat4(new Vec3(10, 20, 30));
		const child = createTranslationMat4(new Vec3(1, 2, 3));

		expect(getMat4Translation(multiplyMat4(parent, child))).toEqual(
			new Vec3(11, 22, 33),
		);
	});

	it("permits a composition target to alias either input", () => {
		const parent = createTranslationMat4(new Vec3(10, 20, 30));
		const child = createTranslationMat4(new Vec3(1, 2, 3));

		expect(multiplyMat4(parent, child, parent)).toBe(parent);
		expect(getMat4Translation(parent)).toEqual(new Vec3(11, 22, 33));
	});

	it("creates an inverse camera translation for an identity rotation", () => {
		const view = createViewMat4(new Vec3(10, 20, 30), Quat.identity());

		expect(getMat4Translation(view)).toEqual(new Vec3(-10, -20, -30));
	});

	it("inverse-transforms points through a rigid frame", () => {
		const transform = new Mat4(
			0,
			0,
			-1,
			0,
			0,
			1,
			0,
			0,
			1,
			0,
			0,
			0,
			10,
			20,
			30,
			1,
		);

		expect(
			inverseTransformRigidPoint3(transform, new Vec3(13, 22, 29)),
		).toEqual(new Vec3(1, 2, 3));
	});

	it("conservatively transforms every corner of an axis-aligned box", () => {
		const bounds = transformAABB3(
			createTranslationMat4(new Vec3(10, 20, 30)),
			new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6)),
		);

		expect(bounds).toEqual(
			new AABB3(new Vec3(9, 18, 27), new Vec3(14, 25, 36)),
		);
	});

	it("writes transformed bounds into a caller-owned target", () => {
		const target = AABB3.zero();
		const bounds = transformAABB3(
			createTranslationMat4(new Vec3(10, 20, 30)),
			new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6)),
			target,
		);

		expect(bounds).toBe(target);
		expect(bounds).toEqual(
			new AABB3(new Vec3(9, 18, 27), new Vec3(14, 25, 36)),
		);
	});

	it("preserves projective corner bounds when input and output alias", () => {
		const matrix = new Mat4(
			-2,
			1,
			0,
			0.1,
			0.5,
			3,
			1,
			0.2,
			1,
			0,
			4,
			0.3,
			7,
			-2,
			5,
			3,
		);
		const bounds = new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6));
		const corners = [];
		for (const x of [bounds.min.x, bounds.max.x])
			for (const y of [bounds.min.y, bounds.max.y])
				for (const z of [bounds.min.z, bounds.max.z])
					corners.push(transformPoint3(matrix, new Vec3(x, y, z)));
		const expected = new AABB3(
			new Vec3(
				Math.min(...corners.map((p) => p.x)),
				Math.min(...corners.map((p) => p.y)),
				Math.min(...corners.map((p) => p.z)),
			),
			new Vec3(
				Math.max(...corners.map((p) => p.x)),
				Math.max(...corners.map((p) => p.y)),
				Math.max(...corners.map((p) => p.z)),
			),
		);
		expect(transformAABB3(matrix, bounds, bounds)).toBe(bounds);
		expect(bounds).toEqual(expected);
	});

	it("leaves output intact when a later bound corner has zero W", () => {
		const matrix = Mat4.identity();
		matrix.m34 = -1;
		const bounds = new AABB3(Vec3.zero(), new Vec3(1, 1, 1));
		const previous = bounds.clone();
		expect(() => transformAABB3(matrix, bounds, bounds)).toThrow("zero W");
		expect(bounds).toEqual(previous);
	});

	it("writes scale, points, and normals into caller-owned targets", () => {
		const matrixTarget = Mat4.zero();
		const pointTarget = Vec3.zero();
		const normalTarget = Vec3.zero();
		const scale = createScaleMat4(new Vec3(2, 3, 4), matrixTarget);

		expect(scale).toBe(matrixTarget);
		expect(transformPoint3(scale, new Vec3(1, 2, 3), pointTarget)).toBe(
			pointTarget,
		);
		expect(pointTarget).toEqual(new Vec3(2, 6, 12));
		expect(transformNormal3(scale, new Vec3(1, 1, 0), normalTarget)).toBe(
			normalTarget,
		);
		expect(normalTarget.x).toBeCloseTo(3 / Math.sqrt(13));
		expect(normalTarget.y).toBeCloseTo(2 / Math.sqrt(13));
		expect(normalTarget.z).toBe(0);
	});

	it("writes matrix elements at an explicit caller-owned offset", () => {
		const values = new Float32Array(20).fill(-1);
		const matrix = new Mat4(
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9,
			10,
			11,
			12,
			13,
			14,
			15,
			16,
		);

		writeMat4ToFloat32Array(matrix, values, 2);

		expect([...values]).toEqual([
			-1, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, -1, -1,
		]);
	});
});
