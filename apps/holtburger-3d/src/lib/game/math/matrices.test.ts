import { describe, expect, it } from "vitest";
import {
	createTranslationMat4,
	createViewMat4,
	getMat4Translation,
	multiplyMat4,
	transformAABB3,
} from "./matrices";
import { AABB3, Quat, Vec3 } from "./types";

describe("matrix composition", () => {
	it("composes child translations into their parent coordinate frame", () => {
		const parent = createTranslationMat4(new Vec3(10, 20, 30));
		const child = createTranslationMat4(new Vec3(1, 2, 3));

		expect(getMat4Translation(multiplyMat4(parent, child))).toEqual(
			new Vec3(11, 22, 33),
		);
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
});
