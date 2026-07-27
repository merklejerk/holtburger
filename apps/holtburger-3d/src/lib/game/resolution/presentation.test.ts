import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import {
	orderResolvedObjectParts,
	resolveObjectPresentationBounds,
	type ResolvedGeometry,
	type ResolvedObjectPart,
} from "./presentation";

describe("orderResolvedObjectParts", () => {
	it("orders a child before its authored parent only after the parent", () => {
		const ordered = orderResolvedObjectParts([
			part(2, 1),
			part(0, null),
			part(1, 0),
		]);

		expect(ordered.map(({ partIndex }) => partIndex)).toEqual([0, 1, 2]);
	});

	it("rejects duplicate, missing, and cyclic parent references", () => {
		expect(() =>
			orderResolvedObjectParts([part(0, null), part(0, null)]),
		).toThrow("duplicate part index 0");
		expect(() => orderResolvedObjectParts([part(0, 1)])).toThrow(
			"references missing parent 1",
		);
		expect(() => orderResolvedObjectParts([part(0, 1), part(1, 0)])).toThrow(
			"cyclic part hierarchy",
		);
	});
});

describe("resolveObjectPresentationBounds", () => {
	it("uses the rendered parent placement and scale hierarchy", () => {
		const pointBounds = new AABB3(new Vec3(1, 0, 0), new Vec3(1, 0, 0));
		const bounds = resolveObjectPresentationBounds(
			[part(0, null), part(1, 0, pointBounds)],
			[scaleAndTranslateX(3, 10), scaleAndTranslateX(2, 1)],
		);

		expect(bounds).toEqual(new AABB3(new Vec3(19, 0, 0), new Vec3(19, 0, 0)));
	});
});

function part(
	partIndex: number,
	parentPartIndex: number | null,
	bounds: AABB3 | null = null,
): ResolvedObjectPart {
	return {
		defaultScale: new Vec3(1, 1, 1),
		geometry: { bounds } as ResolvedGeometry,
		materials: [],
		parentPartIndex,
		partIndex,
	};
}

function scaleAndTranslateX(scale: number, translation: number): Mat4 {
	return new Mat4(scale, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation, 0, 0, 1);
}
