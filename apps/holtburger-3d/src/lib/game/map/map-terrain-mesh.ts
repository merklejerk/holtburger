import { OUTDOOR_TERRAIN_GRID_CELLS } from "../landblocks";
import {
	isWaterTerrainCode,
	roadCodeOf,
	terrainCodeOf,
} from "../terrain/terrain-sample";
import { usesSouthwestToNortheastCut } from "../terrain/terrain-surface";
import type { TerrainGenerationSource } from "../terrain/types";
import { RETAIL_WALKABLE_NORMAL_UP } from "../walkability";

/**
 * One landblock's terrain reduced to what an overhead map draws.
 *
 * Expanded per triangle rather than indexed, because passability is a fact about one face and must
 * not be shared with the neighbouring face across a vertex. Everything else here is genuinely
 * per-corner and interpolates: a hillside, a road edge, and the boundary between two kinds of
 * ground are all continuous.
 */
export interface MapTerrainMesh {
	/** Landblock-local positions, x east and z north-negative, three per triangle. */
	readonly positions: Float32Array;
	/** Smooth per-corner normals, used for hillshading only. */
	readonly normals: Float32Array;
	/**
	 * The authored terrain type at each corner, which the shader resolves to a colour and blends.
	 *
	 * The scene renderer cannot do this — a terrain type there selects a *texture*, and texture
	 * indices do not interpolate, which is why it reproduces retail's authored alpha masks instead.
	 * The map selects one mean colour per type out of a palette, and colours interpolate, so the
	 * blend costs nothing but the absence of a vote.
	 */
	readonly terrainCodes: Uint8Array;
	/** Per-corner road presence, interpolated and thresholded to place the road edge. */
	readonly roadCoverage: Float32Array;
	/**
	 * Whether a body may occupy the triangle, repeated on each of its corners.
	 *
	 * Retail refuses ground for two unrelated reasons, and the map marks both the same way because
	 * a reader asks one question of it: can I go there?
	 *
	 * Too steep is decided here, once, from the triangle's own geometric normal rather than in the
	 * shader from an interpolated one. Smooth normals are central differences across two tiles and
	 * then interpolated again across the face, which systematically under-reports exactly the
	 * features that matter: a 30 m step between adjacent vertices smooths to a gradient of 0.63 and
	 * reads as walkable, while the face it actually forms rises 30 m over 24 m and is not. Because
	 * the map triangulates on retail's authored diagonals, these faces are the surfaces physics
	 * tests, so this is the game's own answer rather than an approximation of it.
	 *
	 * Open water is decided per landblock, because that is the scale retail decides it at: entering
	 * an entirely-water landblock collides outright, whatever the ground under it looks like
	 * (`CLandCell::find_env_collisions`, acclient.c:340387-340390). Water inside a mixed landblock
	 * is deliberately not marked — retail only lowers the contact plane there, and it is wadeable.
	 */
	readonly passable: Float32Array;
	readonly vertexCount: number;
}

/** Grid-vertex facts gathered once before triangles are expanded from them. */
interface TerrainGridVertex {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly normalX: number;
	readonly normalY: number;
	readonly normalZ: number;
	readonly terrainCode: number;
	readonly roadCoverage: number;
}

/**
 * Build one landblock's map terrain from the same authored source the scene terrain generates from.
 *
 * Triangulation follows retail's authored diagonal per cell so ridges break where the ground
 * actually breaks. Normals are central differences over the height grid rather than face averages:
 * a map wants the smooth shape of the land, and the gradient is both cheaper and less faceted than
 * accumulating triangle normals.
 *
 * Edge vertices fall back to one-sided differences because a landblock cannot see its neighbour's
 * heights here. That leaves a normal discontinuity along landblock boundaries; whether it is
 * visible as hillshade seams is a Phase 1 judgement.
 */
export function buildMapTerrainMesh(
	source: TerrainGenerationSource,
): MapTerrainMesh {
	const grid = readTerrainGrid(source);
	const side = source.gridSize;
	const triangleCount = OUTDOOR_TERRAIN_GRID_CELLS ** 2 * 2;
	const vertexCount = triangleCount * 3;
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const terrainCodes = new Uint8Array(vertexCount);
	const roadCoverage = new Float32Array(vertexCount);
	// A float rather than a byte because it feeds a float vertex attribute; storing it as a byte
	// would need a normalising pointer type the map has no other use for.
	const passable = new Float32Array(vertexCount);
	// Retail's landblock water type, which it derives per cell and then folds up: a cell is fully
	// flooded when all four of its corners are water, and the landblock is entirely water when
	// every cell is, so testing every authored vertex once answers the same question
	// (`CLandBlockStruct::CalcWater`, acclient.c:339967-340014).
	const entirelyWater = grid.every((vertex) =>
		isWaterTerrainCode(vertex.terrainCode),
	);

	/** The grid is fixed-size and indexed by construction, so a gap is a programming error. */
	const vertexAt = (index: number): TerrainGridVertex => {
		const vertex = grid[index];
		if (!vertex) throw new Error(`Terrain grid is missing vertex ${index}.`);
		return vertex;
	};

	let cursor = 0;
	const emit = (corners: readonly [number, number, number]): void => {
		// Resolved once as a tuple, so the face's own facts are decided from the same three
		// vertices the corner loop then writes.
		const face = [
			vertexAt(corners[0]),
			vertexAt(corners[1]),
			vertexAt(corners[2]),
		] as const;
		// An entirely-water landblock is impassable whatever shape its bed is, so the geometric
		// test only has to answer for the landblocks a body could otherwise stand in.
		const facePassable = !entirelyWater && isFaceWalkable(face) ? 1 : 0;
		for (const vertex of face) {
			const offset = cursor * 3;
			positions[offset] = vertex.x;
			positions[offset + 1] = vertex.y;
			positions[offset + 2] = vertex.z;
			normals[offset] = vertex.normalX;
			normals[offset + 1] = vertex.normalY;
			normals[offset + 2] = vertex.normalZ;
			terrainCodes[cursor] = vertex.terrainCode;
			roadCoverage[cursor] = vertex.roadCoverage;
			passable[cursor] = facePassable;
			cursor += 1;
		}
	};

	for (let row = 0; row < OUTDOOR_TERRAIN_GRID_CELLS; row += 1) {
		for (let column = 0; column < OUTDOOR_TERRAIN_GRID_CELLS; column += 1) {
			const southwest = row * side + column;
			const southeast = southwest + 1;
			const northwest = southwest + side;
			const northeast = northwest + 1;
			if (usesSouthwestToNortheastCut(source, column, row)) {
				emit([southwest, southeast, northeast]);
				emit([southwest, northeast, northwest]);
			} else {
				emit([southwest, southeast, northwest]);
				emit([northeast, northwest, southeast]);
			}
		}
	}

	return {
		normals,
		passable,
		positions,
		roadCoverage,
		terrainCodes,
		vertexCount,
	};
}

/**
 * Whether one triangle's own surface is shallow enough to stand on.
 *
 * The geometric face normal, against the same retail threshold the host filters interior floors by,
 * so indoors and out the map means one thing by "too steep".
 */
function isFaceWalkable(
	corners: readonly [TerrainGridVertex, TerrainGridVertex, TerrainGridVertex],
): boolean {
	const [a, b, c] = corners;
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const acx = c.x - a.x;
	const acy = c.y - a.y;
	const acz = c.z - a.z;
	// Only the up component decides walkability, so the cross product's other axes are not needed
	// beyond normalising it.
	const normalX = aby * acz - abz * acy;
	const normalY = abz * acx - abx * acz;
	const normalZ = abx * acy - aby * acx;
	const length = Math.hypot(normalX, normalY, normalZ);
	if (length === 0) return true;
	return Math.abs(normalY) / length >= RETAIL_WALKABLE_NORMAL_UP;
}

/** Resolve every authored grid vertex once, before triangles copy from them. */
function readTerrainGrid(
	source: TerrainGenerationSource,
): readonly TerrainGridVertex[] {
	const side = source.gridSize;
	const height = (row: number, column: number): number => {
		const value = source.heights[row * side + column];
		if (value === undefined) {
			throw new Error(
				`Terrain source is missing the height at row ${row}, column ${column}.`,
			);
		}
		return value;
	};
	const grid: TerrainGridVertex[] = [];
	for (let row = 0; row < side; row += 1) {
		for (let column = 0; column < side; column += 1) {
			// Central differences where both neighbours exist, one-sided at the edges. The z
			// gradient is negated because canonical rows run south-to-north while local z runs
			// north-negative.
			const west = Math.max(0, column - 1);
			const east = Math.min(side - 1, column + 1);
			const south = Math.max(0, row - 1);
			const north = Math.min(side - 1, row + 1);
			const dx =
				(height(row, east) - height(row, west)) /
				((east - west) * source.tileSize);
			const dz =
				-(height(north, column) - height(south, column)) /
				((north - south) * source.tileSize);
			const length = Math.hypot(dx, 1, dz);
			const sample = source.terrainSamples[row * side + column];
			if (sample === undefined) {
				throw new Error(
					`Terrain source is missing the sample at row ${row}, column ${column}.`,
				);
			}
			grid.push({
				normalX: -dx / length,
				normalY: 1 / length,
				normalZ: -dz / length,
				roadCoverage: roadCodeOf(sample) === 0 ? 0 : 1,
				terrainCode: terrainCodeOf(sample),
				x: column * source.tileSize,
				y: height(row, column),
				z: -row * source.tileSize,
			});
		}
	}
	return grid;
}
