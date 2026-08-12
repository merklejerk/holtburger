import { AABB3, Vec3 } from "../math/types";
import { getLandblockCoordinates } from "../landblocks";
import { roadCodeOf, terrainCodeOf } from "./terrain-sample";
import type { TerrainGeometryData } from "../renderer/geometry";
import {
	TERRAIN_GRID_CELLS,
	TERRAIN_MESH_STRIDES,
	type TerrainGenerationResult,
	type TerrainGenerationSource,
	type TerrainMeshStride,
	type TerrainPcodeField,
	type TerrainTransitionDirection,
	type TerrainVariantDrawRange,
} from "./types";
import { usesSouthwestToNortheastCut } from "./terrain-surface";

const TRANSITION_DIRECTIONS: readonly TerrainTransitionDirection[] = [
	"viewer-block",
	"north",
	"northeast",
	"east",
	"southeast",
	"south",
	"southwest",
	"west",
	"northwest",
];

/** Renderer-independent boundary for complete landblock terrain generation. */
export interface TerrainGenerator {
	/** Generate every pre-realized terrain variant from one canonical landblock source. */
	generate(source: TerrainGenerationSource): Promise<TerrainGenerationResult>;
	/** Stop accepting terrain jobs and release any executor resources. */
	destroy(): Promise<void>;
}

/**
 * Produces real, canonical-grid terrain on the runtime thread.
 *
 * A terrain source is at most a 9x9 grid and generation materializes fixed, bounded output. Keep
 * this implementation synchronous until profiling demonstrates a worker transport is necessary;
 * the `TerrainGenerator` port preserves that future replacement seam without mislabelling this
 * implementation as a worker pool.
 */
export class InlineTerrainGenerator implements TerrainGenerator {
	#destroyed = false;

	static async build(): Promise<InlineTerrainGenerator> {
		return new InlineTerrainGenerator();
	}

	async generate(
		source: TerrainGenerationSource,
	): Promise<TerrainGenerationResult> {
		if (this.#destroyed) {
			throw new Error(
				"Cannot generate terrain after InlineTerrainGenerator is destroyed.",
			);
		}
		return generateTerrain(source);
	}

	async destroy(): Promise<void> {
		this.#destroyed = true;
	}
}

/** Generate all retail stride/direction geometry variants from one canonical terrain source. */
export function generateTerrain(
	source: TerrainGenerationSource,
): TerrainGenerationResult {
	validateSource(source);
	const geometryParts: number[] = [];
	const normalParts: number[] = [];
	const textureCoordinateParts: number[] = [];
	const indexParts: number[] = [];
	const variants: TerrainVariantDrawRange[] = [];
	let vertexStart = 0;
	let indexStart = 0;

	for (const stride of TERRAIN_MESH_STRIDES) {
		for (const transitionDirection of TRANSITION_DIRECTIONS) {
			const generated = generateVariant(source, stride, transitionDirection);
			geometryParts.push(...generated.positions);
			normalParts.push(...generated.normals);
			textureCoordinateParts.push(...generated.textureCoordinates);
			for (const index of generated.indices)
				indexParts.push(index + vertexStart);
			variants.push({
				bounds: generated.bounds,
				indexCount: generated.indices.length,
				indexStart,
				variant: { stride, transitionDirection },
			});
			vertexStart += generated.positions.length / 3;
			indexStart += generated.indices.length;
		}
	}

	const geometry: TerrainGeometryData = {
		indices: createIndices(indexParts),
		kind: "terrain",
		normals: new Float32Array(normalParts),
		positions: new Float32Array(geometryParts),
		textureCoordinates: new Float32Array(textureCoordinateParts),
	};
	return {
		geometry,
		surfaceFields: TERRAIN_MESH_STRIDES.map((stride) =>
			generateSurfaceField(source, stride),
		),
		variants,
	};
}

interface GeneratedVariant {
	readonly bounds: AABB3;
	readonly indices: readonly number[];
	readonly normals: Float32Array;
	readonly positions: Float32Array;
	readonly textureCoordinates: Float32Array;
}

function generateVariant(
	source: TerrainGenerationSource,
	stride: TerrainMeshStride,
	transitionDirection: TerrainTransitionDirection,
): GeneratedVariant {
	const cells = TERRAIN_GRID_CELLS / stride;
	const sideVertices = cells + 1;
	const heights = generateVariantHeights(source, stride, transitionDirection);
	const positions = new Float32Array(sideVertices * sideVertices * 3);
	const textureCoordinates = new Float32Array(sideVertices * sideVertices * 2);
	for (let row = 0; row < sideVertices; row += 1) {
		for (let column = 0; column < sideVertices; column += 1) {
			const vertex = row * sideVertices + column;
			const positionOffset = vertex * 3;
			// Canonical rows run south-to-north. Render-local -Z is north, matching the existing
			// static-terrain conversion and the identity terrain-root transform.
			positions[positionOffset] = column * stride * source.tileSize;
			positions[positionOffset + 1] = heights[vertex];
			positions[positionOffset + 2] =
				row === 0 ? 0 : -row * stride * source.tileSize;
			const uvOffset = vertex * 2;
			textureCoordinates[uvOffset] = column / cells;
			textureCoordinates[uvOffset + 1] = row / cells;
		}
	}

	const indices: number[] = [];
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const southwest = row * sideVertices + column;
			const southeast = southwest + 1;
			const northwest = southwest + sideVertices;
			const northeast = northwest + 1;
			if (usesSouthwestToNortheastCut(source, column, row)) {
				indices.push(
					southwest,
					southeast,
					northeast,
					southwest,
					northeast,
					northwest,
				);
			} else {
				indices.push(
					southwest,
					southeast,
					northwest,
					northeast,
					northwest,
					southeast,
				);
			}
		}
	}
	return {
		bounds: boundsForPositions(positions),
		indices,
		normals: calculateNormals(positions, indices),
		positions,
		textureCoordinates,
	};
}

function generateVariantHeights(
	source: TerrainGenerationSource,
	stride: TerrainMeshStride,
	transitionDirection: TerrainTransitionDirection,
): Float32Array {
	const cells = TERRAIN_GRID_CELLS / stride;
	const sideVertices = cells + 1;
	const heights = new Float32Array(sideVertices * sideVertices);
	for (let row = 0; row < sideVertices; row += 1) {
		for (let column = 0; column < sideVertices; column += 1) {
			heights[row * sideVertices + column] =
				source.heights[row * stride * source.gridSize + column * stride] ?? NaN;
		}
	}
	if (stride === 1 || transitionDirection === "viewer-block") return heights;

	// Retail's transition adjustment averages odd vertices on each edge facing a coarser
	// neighbor. It changes heights and normals only; topology and pcode fields remain stride-owned.
	if (isNorthFacing(transitionDirection))
		averageRow(heights, sideVertices, cells);
	if (isSouthFacing(transitionDirection)) averageRow(heights, sideVertices, 0);
	if (isEastFacing(transitionDirection))
		averageColumn(heights, sideVertices, cells);
	if (isWestFacing(transitionDirection))
		averageColumn(heights, sideVertices, 0);
	if (stride === 2)
		applyCardinalHalfResolutionClamps(heights, source, transitionDirection);
	return heights;
}

/**
 * Port retail's cardinal `TransAdjust` lowering pass for the 4×4-cell mesh.
 *
 * It samples the authored 9×9 height grid, not the reduced 5×5 vertex grid. ACE and ACViewer's
 * C# ports use the latter width in some expressions, but the retail client indexes the authored
 * grid directly. The clamp applies only to cardinal directions and intentionally affects the edge
 * opposite the ordinary coarse-neighbor averaging pass.
 */
function applyCardinalHalfResolutionClamps(
	heights: Float32Array,
	source: TerrainGenerationSource,
	direction: TerrainTransitionDirection,
): void {
	if (
		direction !== "north" &&
		direction !== "south" &&
		direction !== "east" &&
		direction !== "west"
	) {
		return;
	}
	const sideVertices = TERRAIN_GRID_CELLS / 2 + 1;
	for (
		let coarseCoordinate = 1;
		coarseCoordinate < sideVertices - 1;
		coarseCoordinate += 2
	) {
		const sourceCoordinate = coarseCoordinate * 2;
		if (direction === "north") {
			clampVertexHeight(
				heights,
				0,
				coarseCoordinate,
				source.heights[sourceCoordinate + 1] ?? NaN,
				source.heights[sourceCoordinate + 2] ?? NaN,
				source.heights[sourceCoordinate - 1] ?? NaN,
				source.heights[sourceCoordinate - 2] ?? NaN,
				sideVertices,
			);
			continue;
		}
		if (direction === "south") {
			const row = TERRAIN_GRID_CELLS * source.gridSize;
			clampVertexHeight(
				heights,
				sideVertices - 1,
				coarseCoordinate,
				source.heights[row + sourceCoordinate + 1] ?? NaN,
				source.heights[row + sourceCoordinate + 2] ?? NaN,
				source.heights[row + sourceCoordinate - 1] ?? NaN,
				source.heights[row + sourceCoordinate - 2] ?? NaN,
				sideVertices,
			);
			continue;
		}
		if (direction === "east") {
			clampVertexHeight(
				heights,
				coarseCoordinate,
				0,
				source.heights[(sourceCoordinate + 1) * source.gridSize] ?? NaN,
				source.heights[(sourceCoordinate + 2) * source.gridSize] ?? NaN,
				source.heights[(sourceCoordinate - 1) * source.gridSize] ?? NaN,
				source.heights[(sourceCoordinate - 2) * source.gridSize] ?? NaN,
				sideVertices,
			);
			continue;
		}
		clampVertexHeight(
			heights,
			coarseCoordinate,
			sideVertices - 1,
			source.heights[
				(sourceCoordinate + 1) * source.gridSize + TERRAIN_GRID_CELLS
			] ?? NaN,
			source.heights[
				(sourceCoordinate + 2) * source.gridSize + TERRAIN_GRID_CELLS
			] ?? NaN,
			source.heights[
				(sourceCoordinate - 1) * source.gridSize + TERRAIN_GRID_CELLS
			] ?? NaN,
			source.heights[
				(sourceCoordinate - 2) * source.gridSize + TERRAIN_GRID_CELLS
			] ?? NaN,
			sideVertices,
		);
	}
}

/** Lower one reduced-grid vertex to retail's two source-height extrapolation limits. */
function clampVertexHeight(
	heights: Float32Array,
	row: number,
	column: number,
	height0: number,
	height1: number,
	height2: number,
	height3: number,
	width: number,
): void {
	const index = row * width + column;
	heights[index] = Math.min(
		heights[index] ?? NaN,
		height2 * 2 - height3,
		height0 * 2 - height1,
	);
}

function generateSurfaceField(
	source: TerrainGenerationSource,
	stride: TerrainMeshStride,
): TerrainPcodeField {
	const cells = TERRAIN_GRID_CELLS / stride;
	const cellPcodes = new Uint32Array(cells * cells);
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			const southwest = sourceIndex(source, row * stride, column * stride);
			const southeast = sourceIndex(
				source,
				row * stride,
				(column + 1) * stride,
			);
			const northeast = sourceIndex(
				source,
				(row + 1) * stride,
				(column + 1) * stride,
			);
			const northwest = sourceIndex(
				source,
				(row + 1) * stride,
				column * stride,
			);
			cellPcodes[row * cells + column] = packTerrainPcode([
				source.terrainSamples[southwest],
				source.terrainSamples[southeast],
				source.terrainSamples[northeast],
				source.terrainSamples[northwest],
			]);
		}
	}
	return { cellPcodes, height: cells, stride, width: cells };
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
	indices: readonly number[],
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

function createIndices(indices: readonly number[]): Uint16Array | Uint32Array {
	const maximum = Math.max(...indices);
	return maximum <= 0xffff
		? new Uint16Array(indices)
		: new Uint32Array(indices);
}

function averageRow(values: Float32Array, width: number, row: number): void {
	for (let column = 1; column < width - 1; column += 2) {
		const index = row * width + column;
		values[index] = (values[index - 1] + values[index + 1]) * 0.5;
	}
}

function averageColumn(
	values: Float32Array,
	width: number,
	column: number,
): void {
	for (let row = 1; row < width - 1; row += 2) {
		const index = row * width + column;
		values[index] = (values[index - width] + values[index + width]) * 0.5;
	}
}

function isNorthFacing(direction: TerrainTransitionDirection): boolean {
	return (
		direction === "north" ||
		direction === "northeast" ||
		direction === "northwest"
	);
}

function isSouthFacing(direction: TerrainTransitionDirection): boolean {
	return (
		direction === "south" ||
		direction === "southeast" ||
		direction === "southwest"
	);
}

function isEastFacing(direction: TerrainTransitionDirection): boolean {
	return (
		direction === "east" ||
		direction === "northeast" ||
		direction === "southeast"
	);
}

function isWestFacing(direction: TerrainTransitionDirection): boolean {
	return (
		direction === "west" ||
		direction === "northwest" ||
		direction === "southwest"
	);
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
