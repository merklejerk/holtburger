import { describe, expect, it } from "vitest";
import { AABB3, Vec3 } from "../math/types";
import type { TerrainGeometryData } from "../renderer/geometry";
import { generateTerrain } from "./terrain-generator";
import { TERRAIN_TYPE_COUNT } from "./pcode";
import {
	validateTerrainGenerationTransport,
	validateTerrainGenerationValues,
} from "./terrain-generation-validation";
import {
	TERRAIN_GRID_CELLS,
	type TerrainGenerationResult,
	type TerrainGenerationSource,
	type TerrainPcodeField,
} from "./types";

type Corruption = readonly [
	name: string,
	corrupt: (result: TerrainGenerationResult) => TerrainGenerationResult,
	expectedMessage: string,
];

const VERTEX_COUNT = (TERRAIN_GRID_CELLS + 1) ** 2;

const TRANSPORT_CORRUPTIONS: readonly Corruption[] = [
	[
		"geometry kind",
		(result) => withGeometry(result, { kind: "static" }),
		"non-terrain geometry",
	],
	[
		"position storage",
		(result) => withGeometry(result, { positions: new Uint8Array(1) }),
		"positions must use Float32Array",
	],
	[
		"normal storage",
		(result) => withGeometry(result, { normals: new Uint8Array(1) }),
		"normals must use Float32Array",
	],
	[
		"texture-coordinate storage",
		(result) => withGeometry(result, { textureCoordinates: new Uint8Array(1) }),
		"texture coordinates must use Float32Array",
	],
	[
		"terrain-code storage",
		(result) => withGeometry(result, { terrainColorCodes: new Uint16Array(1) }),
		"terrain codes must use Uint8Array",
	],
	[
		"index storage",
		(result) => withGeometry(result, { indices: new Int16Array(1) }),
		"indices must use unsigned integer storage",
	],
	[
		"position length",
		(result) =>
			withGeometry(result, {
				positions: new Float32Array(VERTEX_COUNT * 3 - 1),
			}),
		"position channels; expected",
	],
	[
		"normal length",
		(result) =>
			withGeometry(result, { normals: new Float32Array(VERTEX_COUNT * 3 - 1) }),
		"normal channels; expected",
	],
	[
		"texture-coordinate length",
		(result) =>
			withGeometry(result, {
				textureCoordinates: new Float32Array(VERTEX_COUNT * 2 - 1),
			}),
		"texture-coordinate channels; expected",
	],
	[
		"terrain-code length",
		(result) =>
			withGeometry(result, {
				terrainColorCodes: new Uint8Array(VERTEX_COUNT - 1),
			}),
		"terrain codes; expected",
	],
	[
		"index length",
		(result) =>
			withGeometry(result, {
				indices: new Uint16Array(TERRAIN_GRID_CELLS ** 2 * 6 - 1),
			}),
		"triangle indices; expected",
	],
	[
		"surface-field width",
		(result) => withSurfaceField(result, { width: TERRAIN_GRID_CELLS - 1 }),
		"surface-field width",
	],
	[
		"surface-field height",
		(result) => withSurfaceField(result, { height: TERRAIN_GRID_CELLS - 1 }),
		"surface-field height",
	],
	[
		"surface-pcode storage",
		(result) => withSurfaceField(result, { cellPcodes: new Uint16Array(1) }),
		"surface pcodes must use Uint32Array",
	],
	[
		"surface-pcode length",
		(result) =>
			withSurfaceField(result, {
				cellPcodes: new Uint32Array(TERRAIN_GRID_CELLS ** 2 - 1),
			}),
		"surface pcodes; expected",
	],
	[
		"finite bounds",
		(result) => ({
			...result,
			bounds: new AABB3(
				new Vec3(Number.NaN, result.bounds.min.y, result.bounds.min.z),
				result.bounds.max,
			),
		}),
		"non-finite minimum x bound",
	],
	[
		"ordered bounds",
		(result) => ({
			...result,
			bounds: new AABB3(
				new Vec3(
					result.bounds.max.x + 1,
					result.bounds.min.y,
					result.bounds.min.z,
				),
				result.bounds.max,
			),
		}),
		"reversed x bounds",
	],
];

describe("terrain generation validation", () => {
	it("accepts the canonical generated result", () => {
		const result = generateTerrain(createSource());

		expect(() => validateTerrainGenerationTransport(result)).not.toThrow();
		expect(() => validateTerrainGenerationValues(result)).not.toThrow();
	});

	it.each(TRANSPORT_CORRUPTIONS)(
		"rejects an incompatible %s",
		(_, corrupt, expectedMessage) => {
			expect(() =>
				validateTerrainGenerationTransport(corrupt(createResult())),
			).toThrow(expectedMessage);
		},
	);

	it.each([
		[
			"position",
			(result: TerrainGenerationResult) => {
				const positions = result.geometry.positions.slice();
				positions[0] = Number.NaN;
				return withGeometry(result, { positions });
			},
			"non-finite position",
		],
		[
			"normal",
			(result: TerrainGenerationResult) => {
				const normals = result.geometry.normals.slice();
				normals[0] = Number.NaN;
				return withGeometry(result, { normals });
			},
			"non-finite normal",
		],
		[
			"texture coordinate",
			(result: TerrainGenerationResult) => {
				const textureCoordinates = result.geometry.textureCoordinates.slice();
				textureCoordinates[0] = Number.NaN;
				return withGeometry(result, { textureCoordinates });
			},
			"non-finite texture coordinate",
		],
		[
			"vertex index",
			(result: TerrainGenerationResult) => {
				const indices = result.geometry.indices.slice();
				indices[0] = VERTEX_COUNT;
				return withGeometry(result, { indices });
			},
			"out-of-range vertex index",
		],
		[
			"terrain code",
			(result: TerrainGenerationResult) => {
				const terrainColorCodes = result.geometry.terrainColorCodes.slice();
				terrainColorCodes[0] = TERRAIN_TYPE_COUNT;
				return withGeometry(result, { terrainColorCodes });
			},
			"out-of-range terrain code",
		],
		[
			"surface pcode",
			(result: TerrainGenerationResult) => {
				const cellPcodes = result.surfaceField.cellPcodes.slice();
				cellPcodes[0] = 0;
				return withSurfaceField(result, { cellPcodes });
			},
			"malformed surface pcode",
		],
	] satisfies readonly Corruption[])(
		"rejects a generated non-finite or out-of-range %s",
		(_, corrupt, expectedMessage) => {
			expect(() =>
				validateTerrainGenerationValues(corrupt(createResult())),
			).toThrow(expectedMessage);
		},
	);
});

function createResult(): TerrainGenerationResult {
	return generateTerrain(createSource());
}

function withGeometry(
	result: TerrainGenerationResult,
	patch: Record<string, unknown>,
): TerrainGenerationResult {
	return {
		...result,
		geometry: { ...result.geometry, ...patch } as TerrainGeometryData,
	};
}

function withSurfaceField(
	result: TerrainGenerationResult,
	patch: Record<string, unknown>,
): TerrainGenerationResult {
	return {
		...result,
		surfaceField: {
			...result.surfaceField,
			...patch,
		} as TerrainPcodeField,
	};
}

function createSource(): TerrainGenerationSource {
	return {
		cellDiagonals: new Uint8Array(TERRAIN_GRID_CELLS ** 2),
		gridSize: TERRAIN_GRID_CELLS + 1,
		heightIndices: new Uint8Array(VERTEX_COUNT),
		heights: new Float32Array(VERTEX_COUNT),
		landblockId: "0xda55ffff",
		terrainSamples: new Uint16Array(VERTEX_COUNT),
		tileSize: 24,
	};
}
