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
	writeMat4ToFloat32Array,
} from "./matrices";
import { AABB3, Mat4, Quat, Vec3 } from "./types";

describe("matrix composition", () => {
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
