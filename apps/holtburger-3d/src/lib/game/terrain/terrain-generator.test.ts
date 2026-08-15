import { describe, expect, it } from "vitest";
import { generateTerrain } from "./terrain-generator";
import { TERRAIN_GRID_CELLS, type TerrainGenerationSource } from "./types";

const SIDE_VERTICES = TERRAIN_GRID_CELLS + 1;
const VERTEX_COUNT = SIDE_VERTICES * SIDE_VERTICES;

describe("generateTerrain", () => {
	it("generates one authored-resolution mesh and pcode field", () => {
		const result = generateTerrain(createSource());

		expect(result.geometry.positions.length).toBe(VERTEX_COUNT * 3);
		expect(result.geometry.normals.length).toBe(VERTEX_COUNT * 3);
		expect(result.geometry.textureCoordinates.length).toBe(VERTEX_COUNT * 2);
		expect(result.geometry.indices.length).toBe(
			TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS * 6,
		);
		expect(result.surfaceField.width).toBe(TERRAIN_GRID_CELLS);
		expect(result.surfaceField.height).toBe(TERRAIN_GRID_CELLS);
		expect(result.surfaceField.cellPcodes.length).toBe(
			TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS,
		);
	});

	it("places every authored vertex at its own source height", () => {
		const source = createSource();
		for (let index = 0; index < source.heights.length; index += 1) {
			source.heights[index] = index;
		}

		const result = generateTerrain(source);

		for (let row = 0; row < SIDE_VERTICES; row += 1) {
			for (let column = 0; column < SIDE_VERTICES; column += 1) {
				const vertex = row * SIDE_VERTICES + column;
				expect(result.geometry.positions[vertex * 3 + 1]).toBe(
					row * source.gridSize + column,
				);
			}
		}
	});

	it("lays the canonical grid out with rows running south to north", () => {
		const source = createSource();
		const result = generateTerrain(source);
		const width = TERRAIN_GRID_CELLS * source.tileSize;

		const southwest = result.geometry.positions.slice(0, 3);
		const northeast = result.geometry.positions.slice(
			(VERTEX_COUNT - 1) * 3,
			VERTEX_COUNT * 3,
		);

		expect([...southwest]).toEqual([0, 0, 0]);
		expect([...northeast]).toEqual([width, 0, -width]);
		expect(result.bounds.min.z).toBe(-width);
		expect(result.bounds.max.z).toBe(0);
	});

	it("uses canonical southwest/southeast/northeast/northwest pcode order", () => {
		const source = createSource();
		source.terrainSamples[0] = 0b00000100;
		source.terrainSamples[1] = 0b00001001;
		source.terrainSamples[10] = 0b00001110;
		source.terrainSamples[9] = 0b00010011;

		const result = generateTerrain(source);

		expect(result.surfaceField.cellPcodes[0]).toBe(
			0x10000000 |
				(0 << 26) |
				(1 << 24) |
				(2 << 22) |
				(3 << 20) |
				(1 << 15) |
				(2 << 10) |
				(3 << 5) |
				4,
		);
	});

	it("uses the transported topology bit for mesh indices", () => {
		const northwestToSoutheast = createSource();
		const southwestToNortheast = createSource();
		southwestToNortheast.cellDiagonals[0] = 1;

		expect([
			...generateTerrain(northwestToSoutheast).geometry.indices.slice(0, 6),
		]).toEqual([0, 1, 9, 10, 9, 1]);
		expect([
			...generateTerrain(southwestToNortheast).geometry.indices.slice(0, 6),
		]).toEqual([0, 1, 10, 0, 10, 9]);
	});

	it("shares an edge exactly with the neighbour that authored the same heights", () => {
		// Adjacent landblocks duplicate the heights along their shared boundary. Uniform resolution
		// is what makes the seam exact: both sides emit the same vertices in the same order, so no
		// stitching pass is needed to close it.
		const east = createSource("0x1211ffff");
		const west = createSource("0x1111ffff");
		for (let row = 0; row < SIDE_VERTICES; row += 1) {
			const height = row * 3 + 1;
			west.heights[row * west.gridSize + TERRAIN_GRID_CELLS] = height;
			east.heights[row * east.gridSize] = height;
		}

		const westResult = generateTerrain(west);
		const eastResult = generateTerrain(east);

		for (let row = 0; row < SIDE_VERTICES; row += 1) {
			const westVertex = row * SIDE_VERTICES + TERRAIN_GRID_CELLS;
			const eastVertex = row * SIDE_VERTICES;
			expect(westResult.geometry.positions[westVertex * 3 + 1]).toBe(
				eastResult.geometry.positions[eastVertex * 3 + 1],
			);
		}
	});

	it("names the terrain code covering the most of the landblock", () => {
		const source = createSource();
		source.terrainSamples.fill(terrainSample(5));
		expect(generateTerrain(source).dominantTerrainCode).toBe(5);

		// A minority patch does not displace the code covering the rest of the grid.
		for (const index of [0, 1, 9, 10]) {
			source.terrainSamples[index] = terrainSample(3);
		}
		expect(generateTerrain(source).dominantTerrainCode).toBe(5);
	});

	it("rejects a source grid that is not the authored size", () => {
		const source = createSource();
		expect(() =>
			generateTerrain({ ...source, gridSize: SIDE_VERTICES + 1 }),
		).toThrow(/source grid/);
	});

	it("rejects a source carrying a non-finite resolved height", () => {
		const source = createSource();
		source.heights[12] = Number.NaN;
		expect(() => generateTerrain(source)).toThrow(/non-finite/);
	});
});

/** Pack one authored terrain code into the sample word's terrain field. */
function terrainSample(terrainCode: number): number {
	return terrainCode << 2;
}

function createSource(landblockId = "0xda55ffff"): TerrainGenerationSource {
	return {
		cellDiagonals: new Uint8Array(TERRAIN_GRID_CELLS ** 2),
		gridSize: SIDE_VERTICES,
		heightIndices: new Uint8Array(VERTEX_COUNT),
		heights: new Float32Array(VERTEX_COUNT),
		landblockId,
		terrainSamples: new Uint16Array(VERTEX_COUNT),
		tileSize: 24,
	};
}
