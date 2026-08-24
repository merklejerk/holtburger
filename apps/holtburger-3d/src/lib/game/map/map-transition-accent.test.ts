import { describe, expect, it } from "vitest";
import { AABB3, Vec3 } from "../math/types";
import { buildTransitionAccentSurface } from "./map-transition-accent";

/** Horizontal extent of the produced quad, which is all the map draws of it. */
function extent(positions: Float32Array): {
	spanX: number;
	spanZ: number;
	y: number;
} {
	const xs = [...positions].filter((_, index) => index % 3 === 0);
	const ys = [...positions].filter((_, index) => index % 3 === 1);
	const zs = [...positions].filter((_, index) => index % 3 === 2);
	return {
		spanX: Math.max(...xs) - Math.min(...xs),
		spanZ: Math.max(...zs) - Math.min(...zs),
		y: ys[0] ?? Number.NaN,
	};
}

describe("buildTransitionAccentSurface", () => {
	it("widens the wall-thin axis and keeps the doorway's own width", () => {
		// A doorway two metres wide in x, standing in a wall with no measurable thickness.
		const surface = buildTransitionAccentSurface(
			new AABB3(new Vec3(10, 4, -5), new Vec3(12, 6, -5)),
			1.5,
		);

		const { spanX, spanZ, y } = extent(surface.positions);
		expect(spanX).toBeCloseTo(2);
		expect(spanZ).toBeCloseTo(1.5);
		// Sits at the doorway's mid-height so the interior depth rule places it on its own level.
		expect(y).toBeCloseTo(5);
		expect(surface.indices).toHaveLength(6);
	});

	it("widens the other axis for a doorway running along z", () => {
		const surface = buildTransitionAccentSurface(
			new AABB3(new Vec3(10, 0, -8), new Vec3(10, 2, -5)),
			1.5,
		);

		const { spanX, spanZ } = extent(surface.positions);
		expect(spanX).toBeCloseTo(1.5);
		expect(spanZ).toBeCloseTo(3);
	});

	it("refuses a thickness that would draw nothing", () => {
		expect(() =>
			buildTransitionAccentSurface(
				new AABB3(new Vec3(0, 0, 0), new Vec3(1, 1, 0)),
				0,
			),
		).toThrow(/positive thickness/);
	});
});
