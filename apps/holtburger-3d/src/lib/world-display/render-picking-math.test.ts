import { describe, expect, it } from "vitest";

import {
	intersectRayPolygon,
	intersectRaySphere,
	pickRenderShape,
} from "./render-picking-math";
import {
	intersectRayRenderBounds,
	type RenderRay,
} from "./render-spatial-math";

describe("render picking math", () => {
	it("intersects ray-aligned bounds and rejects misses", () => {
		expect(
			intersectRayRenderBounds(forwardRay(), {
				min: { x: -1, y: -1, z: 4 },
				max: { x: 1, y: 1, z: 6 },
			}),
		).toBe(4);
		expect(
			intersectRayRenderBounds(forwardRay(), {
				min: { x: 2, y: -1, z: 4 },
				max: { x: 3, y: 1, z: 6 },
			}),
		).toBeNull();
	});

	it("intersects sphere near surfaces, supports inside starts, and rejects misses", () => {
		expect(intersectRaySphere(forwardRay(), { x: 0, y: 0, z: 5 }, 1)).toBe(4);
		expect(
			intersectRaySphere(
				{ origin: { x: 0, y: 0, z: 5 }, direction: { x: 0, y: 0, z: 1 } },
				{ x: 0, y: 0, z: 5 },
				1,
			),
		).toBe(1);
		expect(
			intersectRaySphere(forwardRay(), { x: 3, y: 0, z: 5 }, 1),
		).toBeNull();
	});

	it("intersects convex polygons and rejects outside or parallel rays", () => {
		const square = [
			{ x: -1, y: -1, z: 5 },
			{ x: 1, y: -1, z: 5 },
			{ x: 1, y: 1, z: 5 },
			{ x: -1, y: 1, z: 5 },
		];

		expect(intersectRayPolygon(forwardRay(), square, 0.01)).toEqual({
			distance: 5,
			point: { x: 0, y: 0, z: 5 },
		});
		expect(
			intersectRayPolygon(
				{ origin: { x: 2, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
				square,
				0.01,
			),
		).toBeNull();
		expect(
			intersectRayPolygon(
				{ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
				square,
				0.01,
			),
		).toBeNull();
	});

	it("picks explicit shapes before fallback bounds", () => {
		const pick = pickRenderShape(
			forwardRay(),
			{ kind: "sphere", center: { x: 0, y: 0, z: 5 }, radius: 1 },
			{
				min: { x: -1, y: -1, z: 2 },
				max: { x: 1, y: 1, z: 3 },
			},
		);

		expect(pick).toEqual({ distance: 4, point: { x: 0, y: 0, z: 4 } });
	});
});

function forwardRay(): RenderRay {
	return {
		origin: { x: 0, y: 0, z: 0 },
		direction: { x: 0, y: 0, z: 1 },
	};
}
