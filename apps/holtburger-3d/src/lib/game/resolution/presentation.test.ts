import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import {
	orderResolvedObjectParts,
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

function part(
	partIndex: number,
	parentPartIndex: number | null,
): ResolvedObjectPart {
	return {
		defaultScale: new Vec3(1, 1, 1),
		geometry: {} as ResolvedGeometry,
		materials: [],
		parentPartIndex,
		partIndex,
	};
}
