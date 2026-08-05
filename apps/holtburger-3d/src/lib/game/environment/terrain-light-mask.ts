import {
	OUTDOOR_TERRAIN_GRID_CELLS,
	OUTDOOR_TERRAIN_TILE_SIZE,
} from "../landblocks";
import { MAX_STATIC_LIGHTS, type RuntimeLight } from "./runtime-lights";

/**
 * 32-bit words in one terrain cell's light mask.
 *
 * Bit `n` of word `w` means "the light at index `32 * w + n` of this landblock's uploaded static
 * light array reaches this cell". The bit's position is the light's identity, so the mask is as
 * wide as the array, not as wide as any cell's population — which is what removes the per-cell
 * capacity and its overflow failure mode entirely.
 *
 * Two words, because GLSL ES 3.00 has no 64-bit integer and the archive's worst landblock carries
 * 51 lights: one `uint` addresses only 32 array slots, and lights beyond that would silently never
 * light terrain.
 */
export const TERRAIN_LIGHT_MASK_WORDS = 2;

/** Total mask words in one landblock's grid, and so the length of a mask table. */
export const TERRAIN_LIGHT_MASK_LENGTH =
	OUTDOOR_TERRAIN_GRID_CELLS *
	OUTDOOR_TERRAIN_GRID_CELLS *
	TERRAIN_LIGHT_MASK_WORDS;

// The shader declares the mask as a uvec2 and the texture as RG32UI, so the cap and the mask width
// must agree. Raising MAX_STATIC_LIGHTS past 64 is a shader change, not a constant change; failing
// at module load says so rather than letting the extra lights quietly stop reaching terrain.
if (MAX_STATIC_LIGHTS !== TERRAIN_LIGHT_MASK_WORDS * 32) {
	throw new Error(
		`Terrain light masks address ${TERRAIN_LIGHT_MASK_WORDS * 32} lights but MAX_STATIC_LIGHTS is ${MAX_STATIC_LIGHTS}. Widen the mask in both this module and the terrain shader.`,
	);
}

/**
 * Bucket one landblock's resolved lights into its 8x8 terrain grid.
 *
 * Index `n` of `lights` must be the slot that light occupies in the uniform upload, because the
 * shader uses a set bit to index that array directly. The two are produced in different files, so
 * their agreement is pinned by test.
 *
 * Cells are addressed as the terrain mesh's texture coordinates address them: column runs along
 * +x from the landblock origin, row runs along -z. A light is admitted to every cell its sphere
 * reaches, not merely the cell holding its centre, so a lamp near a boundary lights both sides.
 *
 * Vertical extent is deliberately ignored, exactly as the landblock-level `reachesBounds` test
 * ignores it: terrain height is unbounded here, and a light that is horizontally in range but
 * vertically distant is culled by the shader's own falloff.
 */
export function buildTerrainLightMasks(
	lights: readonly RuntimeLight[],
	landblockOrigin: { readonly x: number; readonly z: number },
): Uint32Array {
	const masks = new Uint32Array(TERRAIN_LIGHT_MASK_LENGTH);
	const count = Math.min(lights.length, MAX_STATIC_LIGHTS);
	for (let index = 0; index < count; index += 1) {
		const light = lights[index]!;
		const word = index >>> 5;
		const bit = 1 << (index & 31);
		// Only the cells the light's horizontal sphere overlaps need testing; the rest cannot
		// contain a reaching fragment.
		const localX = light.position.x - landblockOrigin.x;
		const localZ = light.position.z - landblockOrigin.z;
		const firstColumn = cellIndex(
			(localX - light.range) / OUTDOOR_TERRAIN_TILE_SIZE,
		);
		const lastColumn = cellIndex(
			(localX + light.range) / OUTDOOR_TERRAIN_TILE_SIZE,
		);
		// Rows run along -z, so the light's +z edge yields the first row.
		const firstRow = cellIndex(
			-(localZ + light.range) / OUTDOOR_TERRAIN_TILE_SIZE,
		);
		const lastRow = cellIndex(
			-(localZ - light.range) / OUTDOOR_TERRAIN_TILE_SIZE,
		);
		for (let row = firstRow; row <= lastRow; row += 1) {
			for (let column = firstColumn; column <= lastColumn; column += 1) {
				if (!reachesCell(light, localX, localZ, column, row)) continue;
				masks[
					(row * OUTDOOR_TERRAIN_GRID_CELLS + column) *
						TERRAIN_LIGHT_MASK_WORDS +
						word
				]! |= bit;
			}
		}
	}
	return masks;
}

/** Clamp a fractional cell coordinate into the grid, so an out-of-bounds light still buckets. */
function cellIndex(coordinate: number): number {
	return Math.min(
		Math.max(Math.floor(coordinate), 0),
		OUTDOOR_TERRAIN_GRID_CELLS - 1,
	);
}

/** Whether a light's horizontal sphere intersects one cell's extent. */
function reachesCell(
	light: RuntimeLight,
	localX: number,
	localZ: number,
	column: number,
	row: number,
): boolean {
	const minimumX = column * OUTDOOR_TERRAIN_TILE_SIZE;
	const maximumZ = -row * OUTDOOR_TERRAIN_TILE_SIZE;
	const nearestX = Math.min(
		Math.max(localX, minimumX),
		minimumX + OUTDOOR_TERRAIN_TILE_SIZE,
	);
	const nearestZ = Math.min(
		Math.max(localZ, maximumZ - OUTDOOR_TERRAIN_TILE_SIZE),
		maximumZ,
	);
	const dx = localX - nearestX;
	const dz = localZ - nearestZ;
	return dx * dx + dz * dz < light.range * light.range;
}

/**
 * Mask table admitting every light, for landblocks whose masks cannot be trusted.
 *
 * The renderer's overflow selection reorders the light array by distance from the camera, which
 * invalidates masks built against the gathered order. That path is unreachable on retail content
 * — the worst landblock carries 51 lights against a cap of 64 — but binding this instead of a
 * stale table keeps the fallback correct rather than merely unlikely to be wrong. The shader
 * still bounds iteration by the live light count, so the extra bits cost nothing.
 */
export const TERRAIN_LIGHT_MASK_ALL: Uint32Array = new Uint32Array(
	TERRAIN_LIGHT_MASK_LENGTH,
).fill(0xffffffff);
