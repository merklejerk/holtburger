import { sceneVec3 } from "../../assets/ac-frame";
import { Vec3 } from "../math/types";
import { describe, expect, it } from "vitest";
import {
	OUTDOOR_TERRAIN_GRID_CELLS,
	OUTDOOR_TERRAIN_TILE_SIZE,
} from "../landblocks";
import { MAX_STATIC_LIGHTS, type RuntimeLight } from "./runtime-lights";
import {
	buildTerrainLightMasks,
	TERRAIN_LIGHT_MASK_ALL,
	TERRAIN_LIGHT_MASK_LENGTH,
	TERRAIN_LIGHT_MASK_WORDS,
} from "./terrain-light-mask";

const ORIGIN = { x: 0, z: 0 };

/** A light at a landblock-local offset, with a reach small enough to stay inside one cell. */
function lightAt(localX: number, localZ: number, range = 6): RuntimeLight {
	return {
		position: sceneVec3(new Vec3(localX, 0, localZ)),
		color: { red: 1, green: 1, blue: 1 },
		range,
		intensity: 10,
	};
}

/** Every light index whose bit is set for one cell, in ascending order. */
function lightsInCell(
	masks: Uint32Array,
	column: number,
	row: number,
): number[] {
	const base =
		(row * OUTDOOR_TERRAIN_GRID_CELLS + column) * TERRAIN_LIGHT_MASK_WORDS;
	const found: number[] = [];
	for (let word = 0; word < TERRAIN_LIGHT_MASK_WORDS; word += 1) {
		const bits = masks[base + word]!;
		for (let bit = 0; bit < 32; bit += 1) {
			if ((bits & (1 << bit)) !== 0) found.push(word * 32 + bit);
		}
	}
	return found;
}

/** Cells with any light, as `column,row` pairs. */
function litCells(masks: Uint32Array): string[] {
	const cells: string[] = [];
	for (let row = 0; row < OUTDOOR_TERRAIN_GRID_CELLS; row += 1) {
		for (let column = 0; column < OUTDOOR_TERRAIN_GRID_CELLS; column += 1) {
			if (lightsInCell(masks, column, row).length > 0) {
				cells.push(`${column},${row}`);
			}
		}
	}
	return cells;
}

describe("buildTerrainLightMasks", () => {
	it("marks only the containing cell for a lamp well inside one", () => {
		// Centre of cell (1, 1): local x 36, local z -36, reaching 6 units.
		const masks = buildTerrainLightMasks(
			[
				lightAt(
					OUTDOOR_TERRAIN_TILE_SIZE * 1.5,
					-OUTDOOR_TERRAIN_TILE_SIZE * 1.5,
				),
			],
			ORIGIN,
		);
		expect(litCells(masks)).toEqual(["1,1"]);
	});

	it("marks every cell a lamp near a corner reaches", () => {
		// On the shared corner of cells (2,2), (3,2), (2,3) and (3,3).
		const masks = buildTerrainLightMasks(
			[lightAt(OUTDOOR_TERRAIN_TILE_SIZE * 3, -OUTDOOR_TERRAIN_TILE_SIZE * 3)],
			ORIGIN,
		);
		expect(litCells(masks).sort()).toEqual(["2,2", "2,3", "3,2", "3,3"]);
	});

	it("allocates an all-zero table when no light reaches the landblock", () => {
		const masks = buildTerrainLightMasks([], ORIGIN);
		expect(masks).toHaveLength(TERRAIN_LIGHT_MASK_LENGTH);
		expect(masks.every((word) => word === 0)).toBe(true);
	});

	it("rebases lights against the landblock origin rather than world zero", () => {
		const origin = { x: 960, z: -1920 };
		const masks = buildTerrainLightMasks(
			[
				lightAt(
					origin.x + OUTDOOR_TERRAIN_TILE_SIZE * 0.5,
					origin.z - OUTDOOR_TERRAIN_TILE_SIZE * 0.5,
				),
			],
			origin,
		);
		expect(litCells(masks)).toEqual(["0,0"]);
	});

	it("buckets a neighbour's light that spills across the boundary", () => {
		// Four units west of this landblock's origin, reaching six: only column 0 is touched.
		const masks = buildTerrainLightMasks(
			[lightAt(-4, -OUTDOOR_TERRAIN_TILE_SIZE * 0.5)],
			ORIGIN,
		);
		expect(litCells(masks)).toEqual(["0,0"]);
	});

	it("keeps bit positions equal to array indices, including past the first word", () => {
		// One light per cell along the diagonal, so each index lands in a known distinct cell.
		const lights: RuntimeLight[] = [];
		for (let index = 0; index < MAX_STATIC_LIGHTS; index += 1) {
			const cell = index % OUTDOOR_TERRAIN_GRID_CELLS;
			lights.push(
				lightAt(
					OUTDOOR_TERRAIN_TILE_SIZE * (cell + 0.5),
					-OUTDOOR_TERRAIN_TILE_SIZE * (cell + 0.5),
					1,
				),
			);
		}
		const masks = buildTerrainLightMasks(lights, ORIGIN);
		for (let index = 0; index < MAX_STATIC_LIGHTS; index += 1) {
			const cell = index % OUTDOOR_TERRAIN_GRID_CELLS;
			expect(lightsInCell(masks, cell, cell)).toContain(index);
		}
		// A light in the second mask word must not leak into the first word's cell bits.
		expect(lightsInCell(masks, 0, 0)).toEqual(
			[0, 8, 16, 24, 32, 40, 48, 56].filter(
				(index) => index < MAX_STATIC_LIGHTS,
			),
		);
	});

	it("ignores lights beyond the uniform cap rather than aliasing their bits", () => {
		const lights: RuntimeLight[] = [];
		for (let index = 0; index <= MAX_STATIC_LIGHTS; index += 1) {
			lights.push(
				lightAt(
					OUTDOOR_TERRAIN_TILE_SIZE * 0.5,
					-OUTDOOR_TERRAIN_TILE_SIZE * 0.5,
					1,
				),
			);
		}
		const masks = buildTerrainLightMasks(lights, ORIGIN);
		expect(lightsInCell(masks, 0, 0)).toHaveLength(MAX_STATIC_LIGHTS);
	});
});

describe("TERRAIN_LIGHT_MASK_ALL", () => {
	it("admits every light in every cell", () => {
		expect(TERRAIN_LIGHT_MASK_ALL).toHaveLength(TERRAIN_LIGHT_MASK_LENGTH);
		for (let row = 0; row < OUTDOOR_TERRAIN_GRID_CELLS; row += 1) {
			for (let column = 0; column < OUTDOOR_TERRAIN_GRID_CELLS; column += 1) {
				expect(lightsInCell(TERRAIN_LIGHT_MASK_ALL, column, row)).toHaveLength(
					MAX_STATIC_LIGHTS,
				);
			}
		}
	});
});
