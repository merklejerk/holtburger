import { MAXIMUM_TERRAIN_CODE } from "./terrain-sample";
import { TERRAIN_GRID_CELLS, type TerrainGenerationResult } from "./types";

/**
 * Validate cheap structured-clone shape invariants at the runtime side of the worker boundary.
 *
 * Scalar scans deliberately stay out of this path; the worker performs them before transferring
 * ownership, so repeating them here would put the retired streaming work back on the runtime thread.
 */
export function validateTerrainGenerationTransport(
	result: TerrainGenerationResult,
): void {
	const { geometry } = result;
	requireTransport(
		geometry.kind === "terrain",
		"Terrain worker returned non-terrain geometry.",
	);
	requireTransport(
		geometry.positions instanceof Float32Array,
		"Terrain worker positions must use Float32Array storage.",
	);
	requireTransport(
		geometry.normals instanceof Float32Array,
		"Terrain worker normals must use Float32Array storage.",
	);
	requireTransport(
		geometry.textureCoordinates instanceof Float32Array,
		"Terrain worker texture coordinates must use Float32Array storage.",
	);
	requireTransport(
		geometry.terrainColorCodes instanceof Uint8Array,
		"Terrain worker terrain codes must use Uint8Array storage.",
	);
	requireTransport(
		geometry.indices instanceof Uint16Array ||
			geometry.indices instanceof Uint32Array,
		"Terrain worker indices must use unsigned integer storage.",
	);

	const vertexCount = (TERRAIN_GRID_CELLS + 1) ** 2;
	requireLength(geometry.positions, vertexCount * 3, "position channels");
	requireLength(geometry.normals, vertexCount * 3, "normal channels");
	requireLength(
		geometry.textureCoordinates,
		vertexCount * 2,
		"texture-coordinate channels",
	);
	requireLength(geometry.terrainColorCodes, vertexCount, "terrain codes");
	requireLength(
		geometry.indices,
		TERRAIN_GRID_CELLS ** 2 * 6,
		"triangle indices",
	);

	requireTransport(
		result.surfaceField.width === TERRAIN_GRID_CELLS,
		`Terrain worker surface-field width must be ${TERRAIN_GRID_CELLS}.`,
	);
	requireTransport(
		result.surfaceField.height === TERRAIN_GRID_CELLS,
		`Terrain worker surface-field height must be ${TERRAIN_GRID_CELLS}.`,
	);
	requireTransport(
		result.surfaceField.cellPcodes instanceof Uint32Array,
		"Terrain worker surface pcodes must use Uint32Array storage.",
	);
	requireLength(
		result.surfaceField.cellPcodes,
		TERRAIN_GRID_CELLS ** 2,
		"surface pcodes",
	);

	const { min, max } = result.bounds;
	requireFiniteBound(min.x, "minimum x");
	requireFiniteBound(min.y, "minimum y");
	requireFiniteBound(min.z, "minimum z");
	requireFiniteBound(max.x, "maximum x");
	requireFiniteBound(max.y, "maximum y");
	requireFiniteBound(max.z, "maximum z");
	requireOrderedBounds(min.x, max.x, "x");
	requireOrderedBounds(min.y, max.y, "y");
	requireOrderedBounds(min.z, max.z, "z");
}

function requireTransport(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

function requireLength(
	values: { readonly length: number },
	expected: number,
	label: string,
): void {
	if (values.length !== expected) {
		throw new Error(
			`Terrain worker returned ${values.length} ${label}; expected ${expected}.`,
		);
	}
}

function requireFiniteBound(value: number, label: string): void {
	if (!Number.isFinite(value)) {
		throw new Error(`Terrain worker returned a non-finite ${label} bound.`);
	}
}

function requireOrderedBounds(
	minimum: number,
	maximum: number,
	axis: string,
): void {
	if (minimum > maximum) {
		throw new Error(`Terrain worker returned reversed ${axis} bounds.`);
	}
}

/** Exhaustively validate generated scalar values before the worker transfers its result. */
export function validateTerrainGenerationValues(
	result: TerrainGenerationResult,
): void {
	validateTerrainGenerationTransport(result);
	for (const value of result.geometry.positions)
		requireFinite(value, "position");
	for (const value of result.geometry.normals) requireFinite(value, "normal");
	for (const value of result.geometry.textureCoordinates)
		requireFinite(value, "texture coordinate");
	const vertexCount = result.geometry.positions.length / 3;
	for (const index of result.geometry.indices) {
		if (index >= vertexCount) {
			throw new Error(
				`Terrain worker generated out-of-range vertex index ${index}.`,
			);
		}
	}
	for (const code of result.geometry.terrainColorCodes) {
		if (code > MAXIMUM_TERRAIN_CODE) {
			throw new Error(
				`Terrain worker generated out-of-range terrain code ${code}.`,
			);
		}
	}
	for (const pcode of result.surfaceField.cellPcodes) {
		if ((pcode & 0xf0000000) !== 0x10000000) {
			throw new Error(
				`Terrain worker generated malformed surface pcode 0x${pcode.toString(16)}.`,
			);
		}
	}
}

function requireFinite(value: number, label: string): void {
	if (!Number.isFinite(value)) {
		throw new Error(`Terrain worker generated a non-finite ${label}.`);
	}
}
