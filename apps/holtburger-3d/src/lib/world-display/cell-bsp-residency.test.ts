import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { PreparedPolygonSetBspNode } from "../assets/types";
import {
	landblockRenderPointToCellAcLocalPoint,
	pointInsideCellBsp,
	renderLocalPointToAcLocalPoint,
} from "./cell-bsp-residency";

describe("cell BSP residency", () => {
	it("converts render-local coordinates back to AC-local coordinates", () => {
		expect(renderLocalPointToAcLocalPoint(new Vector3(1, 3, -2))).toEqual({
			x: 1,
			y: 2,
			z: 3,
		});
	});

	it("evaluates CellBSP planes in AC-local space with the retail front-side rule", () => {
		const cellBsp = makeCellBsp({ normal: { x: 1, y: 0, z: 0 }, d: -2 });

		expect(pointInsideCellBsp(cellBsp, { x: 2, y: 0, z: 0 })).toBe(true);
		expect(pointInsideCellBsp(cellBsp, { x: 2.0001, y: 0, z: 0 })).toBe(
			true,
		);
		expect(pointInsideCellBsp(cellBsp, { x: 1.9999, y: 0, z: 0 })).toBe(
			true,
		);
		expect(pointInsideCellBsp(cellBsp, { x: 1.5, y: 0, z: 0 })).toBe(false);
	});

	it("transforms landblock render points through the inverse cell placement before CellBSP checks", () => {
		const inversePlacement = new Matrix4()
			.makeTranslation(10, 30, -20)
			.invert();

		expect(
			landblockRenderPointToCellAcLocalPoint(
				new Vector3(11, 33, -22),
				inversePlacement,
			),
		).toEqual({
			x: 1,
			y: 2,
			z: 3,
		});
	});
});

function makeCellBsp(plane: {
	normal: { x: number; y: number; z: number };
	d: number;
}): PreparedPolygonSetBspNode {
	return {
		kind: "internal",
		tag: "test",
		plane,
		pos: { kind: "leaf", index: 0, solid: 0, sphere: null, polyIds: [] },
		neg: { kind: "leaf", index: 1, solid: 1, sphere: null, polyIds: [] },
		sphere: null,
		polyIds: [],
	};
}
