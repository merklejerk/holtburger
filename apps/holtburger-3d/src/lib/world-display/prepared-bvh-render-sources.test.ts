import { describe, expect, it } from "vitest";

import {
	queryRenderSpaceBvhSources,
	type RenderSpaceBvhSource,
} from "./prepared-bvh-render-sources";
import type { RenderBounds, RenderFrustum } from "./render-spatial-math";

describe("queryRenderSpaceBvhSources", () => {
	it("accepts a fully contained render-space BVH subtree without child bounds tests", () => {
		const result = queryRenderSpaceBvhSources(
			[
				{
					sourceId: "test",
					nodes: [
						node(bounds(0, 2, 0, 2, 0, 2), 1, 2, []),
						node(bounds(0, 1, 0, 1, 0, 1), null, null, [0]),
						node(bounds(1, 2, 1, 2, 1, 2), null, null, [1]),
					],
					itemKeys: [
						"env-render-geometry:cell:02030100",
						"env-portal:cell:02030100:portal:portal/1",
					],
				},
			],
			frustumBounds(-10, 10, -10, 10, -10, 10),
		);

		expect([...result.visibleItemKeys]).toEqual([
			"env-portal:cell:02030100:portal:portal/1",
			"env-render-geometry:cell:02030100",
		]);
		expect(result.fallbackReasons).toEqual([]);
	});
});

function node(
	boundsValue: RenderBounds,
	left: number | null,
	right: number | null,
	itemIndices: number[],
): RenderSpaceBvhSource["nodes"][number] {
	return {
		bounds: boundsValue,
		left,
		right,
		itemIndices,
	};
}

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
