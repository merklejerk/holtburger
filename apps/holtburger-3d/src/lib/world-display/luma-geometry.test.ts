import { describe, expect, it } from "vitest";

import {
	buildLumaPolygonSetGeometry,
	buildLumaPortalApertureGeometry,
	buildLumaTerrainGeometry,
} from "./luma-geometry";

describe("buildLumaTerrainGeometry", () => {
	it("packs terrain vertices into renderer-space coordinates and triangle indices", () => {
		const geometry = buildLumaTerrainGeometry({
			landblockId: 0x12340000,
			gridSize: 2,
			tileSize: 24,
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 2, z: 3 },
				{ x: 4, y: 5, z: 6 },
			],
			triangles: [
				{
					a: 0,
					b: 1,
					c: 2,
					quadIndex: 0,
					triangleInQuad: 0,
					debugTerrainPcode: 0,
					averageHeight: 0,
				},
			],
			quads: [],
			minHeight: 0,
			maxHeight: 6,
		});

		expect([...geometry.positions]).toEqual([0, 0, -0, 1, 3, -2, 4, 6, -5]);
		expect([...geometry.indices]).toEqual([0, 1, 2]);
		expect(geometry.vertexCount).toBe(3);
		expect(geometry.triangleCount).toBe(1);
	});
});

describe("buildLumaPolygonSetGeometry", () => {
	it("uses render triangle first-vertex runs as indices", () => {
		const geometry = buildLumaPolygonSetGeometry({
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

describe("buildLumaPortalApertureGeometry", () => {
	it("triangulates aperture points as a fan", () => {
		const geometry = buildLumaPortalApertureGeometry([
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 1, y: 1, z: 0 },
			{ x: 0, y: 1, z: 0 },
		]);

		expect([...geometry.indices]).toEqual([0, 1, 2, 0, 2, 3]);
		expect(geometry.triangleCount).toBe(2);
	});
});
