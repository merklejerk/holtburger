import { describe, expect, it } from "vitest";

import {
	renderBoundsContainedByFrustum,
	renderBoundsIntersectsFrustum,
	type RenderBounds,
	type RenderFrustum,
} from "./render-spatial-math";

describe("renderBoundsContainedByFrustum", () => {
	it("accepts bounds fully inside every frustum plane", () => {
		expect(
			renderBoundsContainedByFrustum(
				bounds(-1, 1, -1, 1, -1, 1),
				frustumBounds(-10, 10, -10, 10, -10, 10),
			),
		).toBe(true);
	});

	it("rejects bounds that intersect but are not fully inside a frustum plane", () => {
		const box = bounds(9, 11, -1, 1, -1, 1);
		const frustum = frustumBounds(-10, 10, -10, 10, -10, 10);

		expect(renderBoundsIntersectsFrustum(box, frustum)).toBe(true);
		expect(renderBoundsContainedByFrustum(box, frustum)).toBe(false);
	});

	it("rejects bounds fully outside a frustum plane", () => {
		expect(
			renderBoundsContainedByFrustum(
				bounds(11, 12, -1, 1, -1, 1),
				frustumBounds(-10, 10, -10, 10, -10, 10),
			),
		).toBe(false);
	});

	it("treats bounds touching a frustum plane as contained", () => {
		expect(
			renderBoundsContainedByFrustum(
				bounds(-10, 10, -10, 10, -10, 10),
				frustumBounds(-10, 10, -10, 10, -10, 10),
			),
		).toBe(true);
	});
});

function bounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): RenderBounds {
	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function frustumBounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): RenderFrustum {
	return {
		planes: [
			{ normal: { x: 1, y: 0, z: 0 }, constant: -minX },
			{ normal: { x: -1, y: 0, z: 0 }, constant: maxX },
			{ normal: { x: 0, y: 1, z: 0 }, constant: -minY },
			{ normal: { x: 0, y: -1, z: 0 }, constant: maxY },
			{ normal: { x: 0, y: 0, z: 1 }, constant: -minZ },
			{ normal: { x: 0, y: 0, z: -1 }, constant: maxZ },
		],
	};
}
