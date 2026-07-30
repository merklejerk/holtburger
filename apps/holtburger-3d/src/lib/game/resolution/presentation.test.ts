import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import {
	resolveObjectPresentationBounds,
	type ResolvedGeometry,
	type ResolvedObjectPart,
} from "./presentation";

describe("resolveObjectPresentationBounds", () => {
	it("composes every part against the object frame without accumulating siblings", () => {
		const pointBounds = new AABB3(new Vec3(1, 0, 0), new Vec3(1, 0, 0));
		const bounds = resolveObjectPresentationBounds(
			[part(0), part(1, pointBounds)],
			[scaleAndTranslateX(3, 10), scaleAndTranslateX(2, 1)],
		);

		expect(bounds).toEqual(new AABB3(new Vec3(3, 0, 0), new Vec3(3, 0, 0)));
	});

	it("rejects a part with no transform in the pose", () => {
		expect(() =>
			resolveObjectPresentationBounds(
				[part(1, new AABB3(new Vec3(0, 0, 0), new Vec3(0, 0, 0)))],
				[Mat4.identity()],
			),
		).toThrow("no transform for part 1");
	});
});

function part(
	partIndex: number,
	bounds: AABB3 | null = null,
): ResolvedObjectPart {
	return {
		defaultScale: new Vec3(1, 1, 1),
		geometry: { bounds } as ResolvedGeometry,
		materials: [],
		partIndex,
	};
}

function scaleAndTranslateX(scale: number, translation: number): Mat4 {
	return new Mat4(scale, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation, 0, 0, 1);
}
