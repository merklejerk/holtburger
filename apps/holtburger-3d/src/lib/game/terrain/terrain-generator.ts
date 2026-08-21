import { AABB3, Vec3 } from "../math/types";
import { getLandblockCoordinates } from "../landblocks";
import { roadCodeOf, terrainCodeOf } from "./terrain-sample";
import type { TerrainGeometryData } from "../renderer/geometry";
import {
	TERRAIN_GRID_CELLS,
	type TerrainGenerationResult,
	type TerrainGenerationSource,
	type TerrainPcodeField,
} from "./types";
import { usesSouthwestToNortheastCut } from "./terrain-surface";
import type { ClosedWorkerPoolDiagnostics } from "../workers/closed-worker";

/** Vertices along one axis of the authored-resolution mesh. */
const SIDE_VERTICES = TERRAIN_GRID_CELLS + 1;
const VERTEX_COUNT = SIDE_VERTICES * SIDE_VERTICES;
/** Two triangles per authored cell, three indices each. */
const INDEX_COUNT = TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS * 6;

/** Renderer-independent boundary for complete landblock terrain generation. */
export interface TerrainGenerator {
	/** Generate one landblock's terrain mesh and pcode field from its canonical source. */
	generate(source: TerrainGenerationSource): Promise<TerrainGenerationResult>;
	/** Read aggregate executor scheduling facts without exposing job payloads. */
	getDiagnostics(): ClosedWorkerPoolDiagnostics;
	/** Stop accepting terrain jobs and release any executor resources. */
	destroy(): Promise<void>;
}

/**
 * Generate one landblock's terrain at the authored grid resolution.
 *
 * RETAIL DIVERGENCE: retail generated four sampling strides per landblock and lowered the edge
 * vertices facing a coarser neighbour via `CLandBlockStruct::TransAdjust` (acclient.c:339719, called
 * from acclient.c:340183) so the seam between two LOD levels did not crack. We generate the authored
 * 8x8 grid for every landblock at every distance, so there are no mismatched neighbours and nothing
 * to adjust. Distant terrain therefore follows the authored heightmap more closely than retail's
 * did, which changes distant silhouettes. Nothing observes that but the camera: LOD never reached
 * placement or physics, which sample `source.heights` directly (`terrain-surface.ts`). The stride
 * mechanism existed for 1999 triangle budgets; a full-resolution landblock is 128 triangles.
 */
export function generateTerrain(
	source: TerrainGenerationSource,
): TerrainGenerationResult {
	validateSource(source);
	const positions = new Float32Array(VERTEX_COUNT * 3);
	const textureCoordinates = new Float32Array(VERTEX_COUNT * 2);
	const terrainColorCodes = new Uint8Array(VERTEX_COUNT);
	for (let row = 0; row < SIDE_VERTICES; row += 1) {
		for (let column = 0; column < SIDE_VERTICES; column += 1) {
			const vertex = row * SIDE_VERTICES + column;
			const sourceVertex = sourceIndex(source, row, column);
			const positionOffset = vertex * 3;
			// Canonical rows run south-to-north. Render-local -Z is north, matching the existing
			// static-terrain conversion and the identity terrain-root transform.
			positions[positionOffset] = column * source.tileSize;
			positions[positionOffset + 1] = source.heights[sourceVertex] ?? NaN;
			positions[positionOffset + 2] = row === 0 ? 0 : -row * source.tileSize;
			const uvOffset = vertex * 2;
			textureCoordinates[uvOffset] = column / TERRAIN_GRID_CELLS;
			textureCoordinates[uvOffset + 1] = row / TERRAIN_GRID_CELLS;
			terrainColorCodes[vertex] = terrainCodeOf(
				source.terrainSamples[sourceVertex],
			);
		}
	}

	// Vertex indices stay well inside 16 bits at this fixed grid size, so the width is known
	// without scanning the indices for their maximum.
	const indices = new Uint16Array(INDEX_COUNT);
	let cursor = 0;
	for (let row = 0; row < TERRAIN_GRID_CELLS; row += 1) {
		for (let column = 0; column < TERRAIN_GRID_CELLS; column += 1) {
			const southwest = row * SIDE_VERTICES + column;
			const southeast = southwest + 1;
			const northwest = southwest + SIDE_VERTICES;
			const northeast = northwest + 1;
			if (usesSouthwestToNortheastCut(source, column, row)) {
				indices.set(
					[southwest, southeast, northeast, southwest, northeast, northwest],
					cursor,
				);
			} else {
				indices.set(
					[southwest, southeast, northwest, northeast, northwest, southeast],
					cursor,
				);
			}
			cursor += 6;
		}
	}

	const geometry: TerrainGeometryData = {
		indices,
		kind: "terrain",
		normals: calculateNormals(positions, indices),
		positions,
		terrainColorCodes,
		textureCoordinates,
	};
	const surfaceField = generateSurfaceField(source);
	return {
		bounds: boundsForPositions(positions),
		geometry,
		surfaceField,
	};
}

function generateSurfaceField(
	source: TerrainGenerationSource,
): TerrainPcodeField {
	const cellPcodes = new Uint32Array(TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS);
	for (let row = 0; row < TERRAIN_GRID_CELLS; row += 1) {
		for (let column = 0; column < TERRAIN_GRID_CELLS; column += 1) {
			cellPcodes[row * TERRAIN_GRID_CELLS + column] = packTerrainPcode([
				source.terrainSamples[sourceIndex(source, row, column)],
				source.terrainSamples[sourceIndex(source, row, column + 1)],
				source.terrainSamples[sourceIndex(source, row + 1, column + 1)],
				source.terrainSamples[sourceIndex(source, row + 1, column)],
			]);
		}
	}
	return {
		cellPcodes,
		height: TERRAIN_GRID_CELLS,
		width: TERRAIN_GRID_CELLS,
	};
}

function packTerrainPcode(samples: readonly number[]): number {
	if (samples.length !== 4)
		throw new Error("Terrain pcode requires four source samples.");
	const terrainCodes = samples.map(terrainCodeOf);
	const roadCodes = samples.map(roadCodeOf);
	return (
		(0x10000000 |
			(roadCodes[0] << 26) |
			(roadCodes[1] << 24) |
			(roadCodes[2] << 22) |
			(roadCodes[3] << 20) |
			(terrainCodes[0] << 15) |
			(terrainCodes[1] << 10) |
			(terrainCodes[2] << 5) |
			terrainCodes[3]) >>>
		0
	);
}

function calculateNormals(
	positions: Float32Array,
	indices: Uint16Array,
): Float32Array {
	const normals = new Float32Array(positions.length);
	for (let index = 0; index < indices.length; index += 3) {
		const first = indices[index] * 3;
		const second = indices[index + 1] * 3;
		const third = indices[index + 2] * 3;
		const abX = positions[second] - positions[first];
		const abY = positions[second + 1] - positions[first + 1];
		const abZ = positions[second + 2] - positions[first + 2];
		const acX = positions[third] - positions[first];
		const acY = positions[third + 1] - positions[first + 1];
		const acZ = positions[third + 2] - positions[first + 2];
		const normalX = abY * acZ - abZ * acY;
		const normalY = abZ * acX - abX * acZ;
		const normalZ = abX * acY - abY * acX;
		for (const vertex of [first, second, third]) {
			normals[vertex] += normalX;
			normals[vertex + 1] += normalY;
			normals[vertex + 2] += normalZ;
		}
	}
	for (let index = 0; index < normals.length; index += 3) {
		const length = Math.hypot(
			normals[index],
			normals[index + 1],
			normals[index + 2],
		);
		if (length === 0) {
			normals[index + 1] = 1;
			continue;
		}
		normals[index] /= length;
		normals[index + 1] /= length;
		normals[index + 2] /= length;
	}
	return normals;
}

function boundsForPositions(positions: Float32Array): AABB3 {
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (let offset = 0; offset < positions.length; offset += 3) {
		minX = Math.min(minX, positions[offset]);
		minY = Math.min(minY, positions[offset + 1]);
		minZ = Math.min(minZ, positions[offset + 2]);
		maxX = Math.max(maxX, positions[offset]);
		maxY = Math.max(maxY, positions[offset + 1]);
		maxZ = Math.max(maxZ, positions[offset + 2]);
	}
	return new AABB3(new Vec3(minX, minY, minZ), new Vec3(maxX, maxY, maxZ));
}

function sourceIndex(
	source: TerrainGenerationSource,
	row: number,
	column: number,
): number {
	return row * source.gridSize + column;
}

function validateSource(source: TerrainGenerationSource): void {
	if (source.gridSize !== TERRAIN_GRID_CELLS + 1) {
		throw new Error(
			`Terrain generation requires a ${TERRAIN_GRID_CELLS + 1}x${TERRAIN_GRID_CELLS + 1} source grid.`,
		);
	}
	if (!Number.isFinite(source.tileSize) || source.tileSize <= 0) {
		throw new Error("Terrain generation requires a finite positive tile size.");
	}
	getLandblockCoordinates(source.landblockId);
	const expected = source.gridSize * source.gridSize;
	if (
		source.cellDiagonals.length !== TERRAIN_GRID_CELLS ** 2 ||
		source.heightIndices.length !== expected ||
		source.heights.length !== expected ||
		source.terrainSamples.length !== expected
	) {
		throw new Error(
			"Terrain source grid buffers do not match its declared dimensions.",
		);
	}
	if (![...source.heights].every(Number.isFinite)) {
		throw new Error("Terrain source contains non-finite resolved heights.");
	}
}
