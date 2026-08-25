/**
 * The fields packed into one authored terrain sample.
 *
 * Every landblock vertex carries one `u16` classifying the ground there. Two unrelated systems read
 * it for different reasons — the renderer to decide what the ground *looks* like, the ambient scan to
 * decide what it *sounds* like — so the layout lives here once instead of being re-derived at each
 * call site. The client reads the same three fields off the same word
 * (`(v12 >> 2) & 0x1F` and `v12 >> 11`, acclient.c:338040-338046).
 */

/** Road classification in the low two bits; zero means no road. */
export function roadCodeOf(sample: number): number {
	return sample & 0x03;
}

/** Largest terrain type the five-bit terrain field can carry. */
export const MAXIMUM_TERRAIN_CODE = 0x1f;

/** Terrain type, indexing the region's terrain-type table. */
export function terrainCodeOf(sample: number): number {
	return (sample >>> 2) & MAXIMUM_TERRAIN_CODE;
}

/**
 * Scene type, indexing the terrain type's own scene-type list.
 *
 * Selects both the generated scenery placed on the cell and the ambient sounds it authors, which is
 * why this word is the join between two systems that otherwise share nothing.
 */
export function sceneTypeIndexOf(sample: number): number {
	return sample >>> 11;
}

/**
 * Inclusive bounds of the terrain types retail treats as water surfaces.
 *
 * Retail classifies water through a fixed 32-entry `SurfChar` table indexed by terrain type, which
 * marks exactly types 0x10 through 0x14 — running water, standing fresh water, and the three sea
 * classes (`LandDefs.TerrainType`). `CLandBlockStruct::CalcCellWater` reads only that table
 * (acclient.c:339033-339072, where it appears as the unnamed `dword_7C9EC0`); the decoded values
 * are ACE's `LandblockStruct.SurfChar`. Its Rust twin is `terrain_sample_is_water` in
 * `crates/holtburger-content/src/terrain_collision.rs`; the range is duplicated only because it has
 * to cross a language boundary, so change both or neither.
 */
export const WATER_TERRAIN_CODES = { first: 0x10, last: 0x14 } as const;

/** Whether a terrain type is one of retail's water surfaces. */
export function isWaterTerrainCode(terrainCode: number): boolean {
	return (
		terrainCode >= WATER_TERRAIN_CODES.first &&
		terrainCode <= WATER_TERRAIN_CODES.last
	);
}
