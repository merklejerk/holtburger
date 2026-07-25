import { describe, expect, it } from "vitest";
import {
	createScaleMat4,
	createTranslationMat4,
	createViewMat4,
	getMat4Translation,
	multiplyMat4,
	transformNormal3,
	transformPoint3,
	transformAABB3,
} from "./matrices";
import { AABB3, Mat4, Quat, Vec3 } from "./types";

describe("matrix composition", () => {
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
});
