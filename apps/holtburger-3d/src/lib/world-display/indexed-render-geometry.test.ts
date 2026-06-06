import { describe, expect, it } from "vitest";

import {
	buildPolygonSetRenderGeometry,
	buildPortalApertureRenderGeometry,
} from "./indexed-render-geometry";

describe("buildPolygonSetRenderGeometry", () => {
	it("uses render triangle first-vertex runs as indices", () => {
		const geometry = buildPolygonSetRenderGeometry({
			sourceId: 7,
			vertexCount: 6,
			triangleCount: 2,
			positions: new Float32Array([
				0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
			]),
			normals: [],
			uvs: [],
			triangles: [
				{ polygonId: 1, surfaceId: null, firstVertex: 0 },
				{ polygonId: 2, surfaceId: null, firstVertex: 3 },
			],
			surfaceIds: [],
			bounds: null,
		});

		expect([...geometry.indices]).toEqual([0, 1, 2, 3, 4, 5]);
		expect(geometry.triangleCount).toBe(2);
	});
});

describe("buildPortalApertureRenderGeometry", () => {
	it("triangulates aperture points as a fan", () => {
		const geometry = buildPortalApertureRenderGeometry([
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 1, y: 1, z: 0 },
			{ x: 0, y: 1, z: 0 },
		]);

		expect([...geometry.indices]).toEqual([0, 1, 2, 0, 2, 3]);
		expect(geometry.triangleCount).toBe(2);
	});
});
