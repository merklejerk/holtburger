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

/** Terrain type, indexing the region's terrain-type table. */
export function terrainCodeOf(sample: number): number {
	return (sample >>> 2) & 0x1f;
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
