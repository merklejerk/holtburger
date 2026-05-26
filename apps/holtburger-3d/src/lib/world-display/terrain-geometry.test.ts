import { describe, expect, it } from "vitest";

import type { PreparedTerrainMesh } from "../assets/types";
import { buildDebugTerrainGeometry } from "./terrain-geometry";

describe("buildDebugTerrainGeometry", () => {
	it("keeps pcode and quad attributes for the future terrain material path", () => {
		const geometry = buildDebugTerrainGeometry(createTerrainMesh());

		expect(Array.from(geometry.getAttribute("terrainPcode").array)).toEqual([
			1234, 1234, 1234,
		]);
		expect(Array.from(geometry.getAttribute("terrainQuadIndex").array)).toEqual([
			7, 7, 7,
		]);
		expect(
			Array.from(geometry.getAttribute("terrainCornerCodes").array),
		).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
	});
});

function createTerrainMesh(): PreparedTerrainMesh {
	return {
		landblockId: 0xda55ffff,
		gridSize: 2,
		tileSize: 24,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
		triangles: [
			{
				a: 0,
				b: 1,
				c: 2,
				quadIndex: 7,
				triangleInQuad: 0,
				terrainType: 1234,
				averageHeight: 0,
			},
		],
		quads: [
			{
				terrainQuadId: "quad-7",
				row: 0,
				col: 0,
				quadIndex: 7,
				sourceTerrainIndices: [0, 1, 2, 3],
				vertexIndices: [0, 1, 2, 3],
				triangleIndices: [0, 1],
				diagonal: "southwest-northeast",
				cornerTerrainCodes: [1, 2, 3, 4],
				pcode: 1234,
				averageHeight: 0,
				bounds: {
					min: { x: 0, y: 0, z: 0 },
					max: { x: 1, y: 1, z: 1 },
				},
			},
		],
		minHeight: 0,
		maxHeight: 1,
	};
}
