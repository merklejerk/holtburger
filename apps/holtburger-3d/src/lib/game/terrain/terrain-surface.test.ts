import { describe, expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { sampleTerrainSurface } from "./terrain-surface";
import type { TerrainGenerationSource } from "./types";

const GRID_SIZE = 9;
const TILE_SIZE = OUTDOOR_LANDBLOCK_WORLD_SIZE / (GRID_SIZE - 1);

describe("sampleTerrainSurface", () => {
	it("interpolates the rendered full-resolution surface at every point of a planar source", () => {
		const source = createPlanarSource();
		const sample = sampleTerrainSurface(
			source,
			TILE_SIZE * 2.25,
			-TILE_SIZE * 5.75,
		);

		expect(sample).toEqual({
			height: 2.25 * 10 + 5.75 * 100,
			landblockId: source.landblockId,
		});
	});

	it("includes the canonical landblock boundary and rejects points outside it", () => {
		const source = createPlanarSource();

		expect(
			sampleTerrainSurface(
				source,
				OUTDOOR_LANDBLOCK_WORLD_SIZE,
				-OUTDOOR_LANDBLOCK_WORLD_SIZE,
			),
		).toEqual({ height: 8 * 10 + 8 * 100, landblockId: source.landblockId });
		expect(sampleTerrainSurface(source, -0.001, 0)).toBeNull();
		expect(sampleTerrainSurface(source, 0, 0.001)).toBeNull();
	});

	it("uses transported diagonal bits instead of re-deriving topology from the landblock id", () => {
		const northwestToSoutheast = createPlanarSource();
		northwestToSoutheast.heights.fill(0);
		northwestToSoutheast.heights[GRID_SIZE + 1] = 10;
		const southwestToNortheast = {
			...northwestToSoutheast,
			cellDiagonals: new Uint8Array(64),
		};
		southwestToNortheast.cellDiagonals[0] = 1;

		expect(
			sampleTerrainSurface(
				northwestToSoutheast,
				TILE_SIZE * 0.75,
				-TILE_SIZE * 0.5,
			)?.height,
		).toBe(2.5);
		expect(
			sampleTerrainSurface(
				southwestToNortheast,
				TILE_SIZE * 0.75,
				-TILE_SIZE * 0.5,
			)?.height,
		).toBe(5);
	});
});

function createPlanarSource(): TerrainGenerationSource {
	const heights = new Float32Array(GRID_SIZE * GRID_SIZE);
	for (let row = 0; row < GRID_SIZE; row += 1) {
		for (let column = 0; column < GRID_SIZE; column += 1)
			heights[row * GRID_SIZE + column] = column * 10 + row * 100;
	}
	return {
		cellDiagonals: new Uint8Array(64),
		gridSize: GRID_SIZE,
		heightIndices: new Uint8Array(GRID_SIZE * GRID_SIZE),
		heights,
		landblockId: "0xda55ffff",
		terrainSamples: new Uint16Array(GRID_SIZE * GRID_SIZE),
		tileSize: TILE_SIZE,
	};
}
