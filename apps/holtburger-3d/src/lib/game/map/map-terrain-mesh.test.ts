import { describe, expect, it } from "vitest";
import {
	OUTDOOR_TERRAIN_GRID_CELLS,
	OUTDOOR_TERRAIN_GRID_SIZE,
	OUTDOOR_TERRAIN_TILE_SIZE,
} from "../landblocks";
import type { TerrainGenerationSource } from "../terrain/types";
import { RETAIL_WALKABLE_NORMAL_UP } from "../walkability";
import { buildMapTerrainMesh } from "./map-terrain-mesh";

const SIDE = OUTDOOR_TERRAIN_GRID_SIZE;

/** Pack one authored vertex sample the way the client reads it back. */
function sample(terrainCode: number, roadCode = 0): number {
	return (terrainCode << 2) | roadCode;
}

function source(
	overrides: Partial<TerrainGenerationSource> = {},
): TerrainGenerationSource {
	return {
		cellDiagonals: new Uint8Array(OUTDOOR_TERRAIN_GRID_CELLS ** 2),
		gridSize: SIDE,
		heightIndices: new Uint8Array(SIDE * SIDE),
		heights: new Float32Array(SIDE * SIDE),
		landblockId: "0xda55ffff",
		terrainSamples: new Uint16Array(SIDE * SIDE),
		tileSize: OUTDOOR_TERRAIN_TILE_SIZE,
		...overrides,
	};
}

describe("buildMapTerrainMesh", () => {
	it("expands one triangle pair per authored cell", () => {
		const mesh = buildMapTerrainMesh(source());

		expect(mesh.vertexCount).toBe(OUTDOOR_TERRAIN_GRID_CELLS ** 2 * 2 * 3);
		expect(mesh.positions).toHaveLength(mesh.vertexCount * 3);
		expect(mesh.terrainCodes).toHaveLength(mesh.vertexCount);
		expect(mesh.roadCoverage).toHaveLength(mesh.vertexCount);
	});

	it("lays vertices out in the scene terrain frame", () => {
		const heights = new Float32Array(SIDE * SIDE);
		heights[0] = 17;
		const mesh = buildMapTerrainMesh(source({ heights }));

		// The first triangle's first corner is the south-west vertex of cell (0, 0).
		expect(mesh.positions[0]).toBe(0);
		expect(mesh.positions[1]).toBe(17);
		expect(mesh.positions[2]).toBe(-0);
		// Its south-east neighbour is one tile east, still on the southern row.
		expect(mesh.positions[3]).toBe(OUTDOOR_TERRAIN_TILE_SIZE);
		expect(mesh.positions[5]).toBe(-0);
	});

	it("gives a triangle the terrain type most of its corners agree on", () => {
		// Cell (0, 0)'s southern corners are type 9 and its northern ones type 4, so the first
		// triangle — south-west, south-east, north-east — is two to one for 9.
		// The default diagonal makes the first triangle south-west, south-east, north-west, so its
		// two southern corners outvote the northern one.
		const terrainSamples = new Uint16Array(SIDE * SIDE).fill(sample(4));
		terrainSamples[0] = sample(9);
		terrainSamples[1] = sample(9);
		const mesh = buildMapTerrainMesh(source({ terrainSamples }));

		expect([...mesh.terrainCodes.slice(0, 3)]).toEqual([9, 9, 9]);
	});

	it("resolves a three-way corner disagreement without depending on corner order", () => {
		// The default diagonal makes the first triangle south-west, south-east, north-west.
		const terrainSamples = new Uint16Array(SIDE * SIDE).fill(sample(4));
		terrainSamples[0] = sample(7);
		terrainSamples[1] = sample(9);
		terrainSamples[SIDE] = sample(5);
		const mesh = buildMapTerrainMesh(source({ terrainSamples }));

		// No majority exists, so the lowest authored code wins for every corner alike.
		expect([...mesh.terrainCodes.slice(0, 3)]).toEqual([5, 5, 5]);
	});

	it("carries road presence per corner so the edge can be interpolated", () => {
		const terrainSamples = new Uint16Array(SIDE * SIDE);
		terrainSamples[0] = sample(3, 2);
		const mesh = buildMapTerrainMesh(source({ terrainSamples }));

		// Only the south-west corner of the first triangle carries a road.
		expect([...mesh.roadCoverage.slice(0, 3)]).toEqual([1, 0, 0]);
	});

	it("gives flat ground a straight-up normal", () => {
		const mesh = buildMapTerrainMesh(source());

		for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
			expect(mesh.normals[vertex * 3]).toBeCloseTo(0);
			expect(mesh.normals[vertex * 3 + 1]).toBeCloseTo(1);
			expect(mesh.normals[vertex * 3 + 2]).toBeCloseTo(0);
		}
	});

	it("tilts normals away from rising ground and keeps them unit length", () => {
		// A constant eastward climb: one tile size of rise per tile, a 45 degree slope.
		const heights = new Float32Array(SIDE * SIDE);
		for (let row = 0; row < SIDE; row += 1) {
			for (let column = 0; column < SIDE; column += 1) {
				heights[row * SIDE + column] = column * OUTDOOR_TERRAIN_TILE_SIZE;
			}
		}
		const mesh = buildMapTerrainMesh(source({ heights }));

		const [x, y, z] = [mesh.normals[0], mesh.normals[1], mesh.normals[2]] as [
			number,
			number,
			number,
		];
		expect(Math.hypot(x, y, z)).toBeCloseTo(1);
		// Leaning west, away from the climb, and too steep to walk up.
		expect(x).toBeCloseTo(-Math.SQRT1_2);
		expect(y).toBeCloseTo(Math.SQRT1_2);
		expect(z).toBeCloseTo(0);
		// Retail's limit is about 48.4 degrees, so a 45 degree slope is still walkable.
		expect(y).toBeGreaterThan(RETAIL_WALKABLE_NORMAL_UP);
	});

	it("marks ground past retail's walkable limit as unwalkable", () => {
		// Two tile sizes of rise per tile is roughly 63 degrees, well past the limit.
		const heights = new Float32Array(SIDE * SIDE);
		for (let row = 0; row < SIDE; row += 1) {
			for (let column = 0; column < SIDE; column += 1) {
				heights[row * SIDE + column] = column * OUTDOOR_TERRAIN_TILE_SIZE * 2;
			}
		}
		const mesh = buildMapTerrainMesh(source({ heights }));

		expect(mesh.normals[1]).toBeLessThan(RETAIL_WALKABLE_NORMAL_UP);
		expect([...mesh.walkable.slice(0, 3)]).toEqual([0, 0, 0]);
	});

	it("calls flat and gently sloped ground walkable", () => {
		expect([...buildMapTerrainMesh(source()).walkable.slice(0, 3)]).toEqual([
			1, 1, 1,
		]);
	});

	it("judges a step from the triangle's own face, not a smoothed gradient", () => {
		// One 30 m step, placed inside the grid so the central difference spans two tiles either
		// side of it rather than falling back to a one-sided edge difference.
		const stepColumn = 4;
		const heights = new Float32Array(SIDE * SIDE);
		for (let row = 0; row < SIDE; row += 1) {
			for (let column = stepColumn; column < SIDE; column += 1) {
				heights[row * SIDE + column] = 30;
			}
		}
		const mesh = buildMapTerrainMesh(source({ heights }));

		// The trap: smoothing spreads the step over two tiles, and that gradient is climbable.
		const smoothedUp =
			1 / Math.hypot(30 / (2 * OUTDOOR_TERRAIN_TILE_SIZE), 1, 0);
		expect(smoothedUp).toBeGreaterThan(RETAIL_WALKABLE_NORMAL_UP);
		// The face itself rises 30 m over one tile and cannot be climbed; the map agrees with it.
		const steppingCell = stepColumn - 1;
		const firstCornerOfCell = steppingCell * 2 * 3;
		expect(mesh.walkable[firstCornerOfCell]).toBe(0);
	});

	function withFirstDiagonal(value: number): Uint8Array {
		const diagonals = new Uint8Array(OUTDOOR_TERRAIN_GRID_CELLS ** 2);
		diagonals[0] = value;
		return diagonals;
	}

	it("follows the authored diagonal of each cell", () => {
		// Heights identify corners: the diagonal decides which of them the first triangle uses.
		const heights = new Float32Array(SIDE * SIDE);
		heights[SIDE] = 5; // north-west corner of cell (0, 0)
		const cut = buildMapTerrainMesh(
			source({ cellDiagonals: withFirstDiagonal(1), heights }),
		);
		const other = buildMapTerrainMesh(
			source({ cellDiagonals: withFirstDiagonal(0), heights }),
		);

		// A south-west to north-east cut leaves the north-west corner out of the first triangle;
		// the opposite diagonal includes it.
		expect([...cut.positions.slice(0, 9)].includes(5)).toBe(false);
		expect([...other.positions.slice(0, 9)].includes(5)).toBe(true);
	});

	it("fails loudly when the authored source is short a height", () => {
		expect(() =>
			buildMapTerrainMesh(source({ heights: new Float32Array(4) })),
		).toThrow(/missing the height/);
	});
});
