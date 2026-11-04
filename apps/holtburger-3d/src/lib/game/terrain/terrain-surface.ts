import { TERRAIN_GRID_CELLS, type TerrainGenerationSource } from "./types";

/** One authoritative terrain height sampled from an installed outdoor source. */
export interface TerrainSurfaceSample {
	/** Outdoor landblock supplying the sampled source grid. */
	readonly landblockId: TerrainGenerationSource["landblockId"];
	/** Interpolated world-space surface height. */
	readonly height: number;
}

/**
 * Sample the full-resolution generated terrain surface in landblock-local coordinates.
 *
 * The interpolation follows the same deterministic diagonal split used by the stride-one mesh,
 * so an Explorer focus pose is placed against the geometry it will render rather than an
 * unrelated bilinear approximation.
 */
export function sampleTerrainSurface(
	source: TerrainGenerationSource,
	localX: number,
	localZ: number,
): TerrainSurfaceSample | null {
	const width = source.tileSize * TERRAIN_GRID_CELLS;
	if (localX < 0 || localX > width || localZ < -width || localZ > 0)
		return null;

	const columnPosition = localX / source.tileSize;
	const rowPosition = -localZ / source.tileSize;
	const column = Math.min(TERRAIN_GRID_CELLS - 1, Math.floor(columnPosition));
	const row = Math.min(TERRAIN_GRID_CELLS - 1, Math.floor(rowPosition));
	const east = columnPosition - column;
	const north = rowPosition - row;
	const southwest = source.heights[row * source.gridSize + column];
	const southeast = source.heights[row * source.gridSize + column + 1];
	const northwest = source.heights[(row + 1) * source.gridSize + column];
	const northeast = source.heights[(row + 1) * source.gridSize + column + 1];
	if (
		[southwest, southeast, northwest, northeast].some(
			(height) => height === undefined,
		)
	) {
		throw new Error(
			"Terrain source is missing a height needed for surface sampling.",
		);
	}

	const height = usesSouthwestToNortheastCut(source, column, row)
		? sampleSouthwestToNortheast(
				southwest,
				southeast,
				northeast,
				northwest,
				east,
				north,
			)
		: sampleNorthwestToSoutheast(
				southwest,
				southeast,
				northeast,
				northwest,
				east,
				north,
			);
	return { height, landblockId: source.landblockId };
}

/** Reads retail's host-computed diagonal choice for one canonical terrain cell. */
export function usesSouthwestToNortheastCut(
	source: Pick<TerrainGenerationSource, "cellDiagonals">,
	cellColumn: number,
	cellRow: number,
): boolean {
	const diagonal =
		source.cellDiagonals[cellRow * TERRAIN_GRID_CELLS + cellColumn];
	if (diagonal === undefined) {
		throw new Error(
			`Terrain cell (${cellColumn}, ${cellRow}) is outside the authored diagonal grid.`,
		);
	}
	return diagonal !== 0;
}

function sampleSouthwestToNortheast(
	southwest: number,
	southeast: number,
	northeast: number,
	northwest: number,
	east: number,
	north: number,
): number {
	return north <= east
		? southwest * (1 - east) + southeast * (east - north) + northeast * north
		: southwest * (1 - north) + northeast * east + northwest * (north - east);
}

function sampleNorthwestToSoutheast(
	southwest: number,
	southeast: number,
	northeast: number,
	northwest: number,
	east: number,
	north: number,
): number {
	return east + north <= 1
		? southwest * (1 - east - north) + southeast * east + northwest * north
		: northeast * (east + north - 1) +
				southeast * (1 - north) +
				northwest * (1 - east);
}
