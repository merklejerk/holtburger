import { OUTDOOR_TERRAIN_GRID_CELLS } from "../landblocks";
import { roadCodeOf, terrainCodeOf } from "../terrain/terrain-sample";
import { usesSouthwestToNortheastCut } from "../terrain/terrain-surface";
import type { TerrainGenerationSource } from "../terrain/types";
import { RETAIL_WALKABLE_NORMAL_UP } from "../walkability";

/**
 * One landblock's terrain reduced to what an overhead map draws.
 *
 * Expanded per triangle rather than indexed, because classification and shape want different
 * things from the same mesh. A terrain type describes a whole patch of ground and must not bleed
 * across its boundary, so every corner of a triangle carries that triangle's one resolved type and
 * flat interpolation becomes independent of which corner the driver treats as provoking. Road
 * coverage and normals stay per-corner and interpolate, because a road edge and a hillside are
 * both genuinely continuous.
 */
export interface MapTerrainMesh {
	/** Landblock-local positions, x east and z north-negative, three per triangle. */
	readonly positions: Float32Array;
	/** Smooth per-corner normals, used for hillshading only. */
	readonly normals: Float32Array;
	/** The triangle's one resolved terrain type, repeated on each of its corners. */
	readonly terrainCodes: Uint8Array;
	/** Per-corner road presence, interpolated and thresholded to place the road edge. */
	readonly roadCoverage: Float32Array;
	/**
	 * Whether the triangle can be stood on, repeated on each of its corners.
	 *
	 * Decided here, once, from the triangle's own geometric normal rather than in the shader from
	 * an interpolated one. Smooth normals are central differences across two tiles and then
	 * interpolated again across the face, which systematically under-reports exactly the features
	 * that matter: a 30 m step between adjacent vertices smooths to a gradient of 0.63 and reads as
	 * walkable, while the face it actually forms rises 30 m over 24 m and is not. Because the map
	 * triangulates on retail's authored diagonals, these faces are the surfaces physics tests, so
	 * this is the game's own answer rather than an approximation of it.
	 */
	readonly walkable: Float32Array;
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
	const walkable = new Float32Array(vertexCount);

	let cursor = 0;
	const emit = (corners: readonly [number, number, number]): void => {
		const faceWalkable = isFaceWalkable(
			corners.map((index) => {
				const vertex = grid[index];
				if (!vertex) {
					throw new Error(`Terrain grid is missing vertex ${index}.`);
				}
				return vertex;
			}) as [TerrainGridVertex, TerrainGridVertex, TerrainGridVertex],
		)
			? 1
			: 0;
		const resolved = dominantTerrainCode(
			corners.map((index) => {
				const vertex = grid[index];
				if (!vertex) {
					throw new Error(`Terrain grid is missing vertex ${index}.`);
				}
				return vertex.terrainCode;
			}),
		);
		for (const index of corners) {
			const vertex = grid[index];
			if (!vertex) {
				throw new Error(`Terrain grid is missing vertex ${index}.`);
			}
			const offset = cursor * 3;
			positions[offset] = vertex.x;
			positions[offset + 1] = vertex.y;
			positions[offset + 2] = vertex.z;
			normals[offset] = vertex.normalX;
			normals[offset + 1] = vertex.normalY;
			normals[offset + 2] = vertex.normalZ;
			terrainCodes[cursor] = resolved;
			roadCoverage[cursor] = vertex.roadCoverage;
			walkable[cursor] = faceWalkable;
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
		positions,
		roadCoverage,
		terrainCodes,
		vertexCount,
		walkable,
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

/**
 * The terrain type a triangle is drawn as: whichever type most of its corners agree on.
 *
 * Ties break toward the lowest code so the answer depends on the authored data alone, never on
 * corner order or on which vertex a driver happens to treat as provoking.
 */
function dominantTerrainCode(codes: readonly number[]): number {
	let best = Number.POSITIVE_INFINITY;
	let bestCount = 0;
	for (const code of codes) {
		const count = codes.filter((other) => other === code).length;
		if (count > bestCount || (count === bestCount && code < best)) {
			best = code;
			bestCount = count;
		}
	}
	return best;
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
