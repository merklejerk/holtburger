import type { TerrainAlphaMap, TerrainRoadAlphaMap } from "./types";

/** Every five-bit authored terrain color code in canonical numeric order. */
export const TERRAIN_COLOR_CODES = [
	0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
	22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
] as const;
/** Number of terrain types addressable by the five-bit terrain portion of a pcode. */
export const TERRAIN_TYPE_COUNT = TERRAIN_COLOR_CODES.length;
/** Terrain descriptor reserved by retail for the common road color surface. */
export const ROAD_TERRAIN_TYPE = 0x20;
/** Complete material lookup domain: authored color codes followed by retail's road surface. */
export const TERRAIN_MATERIAL_CODES = [
	...TERRAIN_COLOR_CODES,
	ROAD_TERRAIN_TYPE,
] as const;
/** One code admitted by the complete active-region terrain material lookup. */
export type TerrainMaterialCode = (typeof TERRAIN_MATERIAL_CODES)[number];

/** Ordered pcode corners match retail's southwest, southeast, northeast, northwest packing. */
export type TerrainPcodeCorner =
	"southwest" | "southeast" | "northeast" | "northwest";

export interface TerrainOverlaySelection {
	readonly terrainCode: number;
	readonly shapeCode: number;
}

export interface RoadOverlaySelection {
	readonly roadCode: number;
}

export interface TerrainAlphaSelection {
	readonly map: TerrainAlphaMap;
	readonly rotations: number;
}

export interface RoadAlphaSelection {
	readonly map: TerrainRoadAlphaMap;
	readonly rotations: number;
}

const CORNERS: readonly TerrainPcodeCorner[] = [
	"southwest",
	"southeast",
	"northeast",
	"northwest",
];
const TERRAIN_SHIFTS = [15, 10, 5, 0] as const;
const ROAD_SHIFTS = [26, 24, 22, 20] as const;
const TERRAIN_CODE_MASK = 0x1f;
const ROAD_CODE_MASK = 0x03;
const CODE_ROTATION_MODULUS = 15;
const VARIATION_MULTIPLIER = 1_379_576_222;
const VARIATION_OFFSET = 1_372_186_442;
const UINT32_SCALE = 2.3283064e-10;

/** Extract one five-bit terrain code from a retail landscape pcode. */
export function terrainCodeAt(
	pcode: number,
	corner: TerrainPcodeCorner,
): number {
	return (pcode >>> TERRAIN_SHIFTS[cornerIndex(corner)]) & TERRAIN_CODE_MASK;
}

/** Extract one two-bit road code from a retail landscape pcode. */
export function roadCodeAt(pcode: number, corner: TerrainPcodeCorner): number {
	return (pcode >>> ROAD_SHIFTS[cornerIndex(corner)]) & ROAD_CODE_MASK;
}

/** Return the terrain base code and ordered overlays selected by retail's TexMerge algorithm. */
export function selectTerrainOverlays(pcode: number): {
	readonly baseTerrainCode: number;
	readonly overlays: readonly TerrainOverlaySelection[];
} {
	const codes = CORNERS.map((corner) => terrainCodeAt(pcode, corner));
	for (let baseIndex = 0; baseIndex < codes.length - 1; baseIndex += 1) {
		for (
			let comparisonIndex = baseIndex + 1;
			comparisonIndex < codes.length;
			comparisonIndex += 1
		) {
			if (codes[baseIndex] === codes[comparisonIndex]) {
				return selectRepeatedTerrainOverlays(codes, baseIndex);
			}
		}
	}
	return {
		baseTerrainCode: codes[0],
		overlays: codes.slice(1).map((terrainCode, index) => ({
			shapeCode: 1 << (index + 1),
			terrainCode,
		})),
	};
}

/** Return retail's full-road state and ordered road overlay codes. */
export function selectRoadOverlays(pcode: number): {
	readonly fullRoad: boolean;
	readonly overlays: readonly RoadOverlaySelection[];
} {
	const mask = CORNERS.reduce(
		(result, corner, index) =>
			roadCodeAt(pcode, corner) === 0 ? result : result | (1 << index),
		0,
	);
	if (mask === 0xf) return { fullRoad: true, overlays: [] };
	const codes = roadOverlayCodes(mask);
	return {
		fullRoad: false,
		overlays: codes.map((roadCode) => ({ roadCode })),
	};
}

/** Select retail's pcode-stable terrain-map variation and rotation for one overlay shape. */
export function selectTerrainAlphaMap(
	pcode: number,
	shapeCode: number,
	cornerMaps: readonly TerrainAlphaMap[],
	sideMaps: readonly TerrainAlphaMap[],
): TerrainAlphaSelection | null {
	const maps = isCornerShapeCode(shapeCode) ? cornerMaps : sideMaps;
	if (maps.length === 0) return null;
	const map = maps[terrainVariationIndex(pcode, maps.length)];
	const rotations = rotationsToMatch(map.terrainCode, shapeCode);
	return rotations === null ? null : { map, rotations };
}

/** Select retail's pcode-stable road-map variation and rotation for one road shape. */
export function selectRoadAlphaMap(
	pcode: number,
	roadCode: number,
	maps: readonly TerrainRoadAlphaMap[],
): RoadAlphaSelection | null {
	if (maps.length === 0) return null;
	const startIndex = terrainVariationIndex(pcode, maps.length);
	for (let offset = 0; offset < maps.length; offset += 1) {
		const map = maps[(startIndex + offset) % maps.length];
		const rotations = rotationsToMatch(map.roadCode, roadCode);
		if (rotations !== null) return { map, rotations };
	}
	return null;
}

/** Match retail's unsigned pcode hash used to select a variation from an ordered map list. */
function terrainVariationIndex(pcode: number, count: number): number {
	if (!Number.isInteger(count) || count <= 0) {
		throw new Error(
			"Terrain variation selection requires a positive map count.",
		);
	}
	const hashed =
		(Math.imul(VARIATION_MULTIPLIER, pcode) - VARIATION_OFFSET) >>> 0;
	const index = Math.floor(hashed * UINT32_SCALE * count);
	return index >= count ? 0 : index;
}

/** Return the number of quarter turns needed to rotate a canonical mask code to a requested code. */
export function rotationsToMatch(
	canonicalCode: number,
	requestedCode: number,
): number | null {
	let rotatedCode = canonicalCode;
	for (let rotations = 0; rotations < 4; rotations += 1) {
		if (rotatedCode === requestedCode) return rotations;
		rotatedCode = rotateCode(rotatedCode);
	}
	return null;
}

function selectRepeatedTerrainOverlays(
	codes: readonly number[],
	baseIndex: number,
): {
	readonly baseTerrainCode: number;
	readonly overlays: readonly TerrainOverlaySelection[];
} {
	const baseTerrainCode = codes[baseIndex];
	const overlays: TerrainOverlaySelection[] = [];
	let firstOverlayTerrainCode: number | undefined;
	let firstOverlayShapeCode: number | undefined;
	for (let index = 0; index < codes.length; index += 1) {
		const terrainCode = codes[index];
		if (terrainCode === baseTerrainCode) continue;
		const shapeCode = 1 << index;
		if (firstOverlayTerrainCode === undefined) {
			firstOverlayTerrainCode = terrainCode;
			firstOverlayShapeCode = shapeCode;
			overlays.push({ shapeCode, terrainCode });
			continue;
		}
		if (
			terrainCode === firstOverlayTerrainCode &&
			firstOverlayShapeCode === 1 << (index - 1)
		) {
			overlays[0] = {
				shapeCode: firstOverlayShapeCode + shapeCode,
				terrainCode,
			};
			continue;
		}
		overlays.push({ shapeCode, terrainCode });
		break;
	}
	return { baseTerrainCode, overlays };
}

function roadOverlayCodes(mask: number): readonly number[] {
	switch (mask) {
		case 0xe:
			return [6, 12];
		case 0xd:
			return [9, 12];
		case 0xb:
			return [9, 3];
		case 0x7:
			return [3, 6];
		case 0:
			return [];
		default:
			return [mask];
	}
}

function isCornerShapeCode(shapeCode: number): boolean {
	return (
		shapeCode === 1 || shapeCode === 2 || shapeCode === 4 || shapeCode === 8
	);
}

function rotateCode(code: number): number {
	const doubled = code * 2;
	return doubled >= 16 ? doubled - CODE_ROTATION_MODULUS : doubled;
}

function cornerIndex(corner: TerrainPcodeCorner): number {
	const index = CORNERS.indexOf(corner);
	if (index < 0) throw new Error(`Unknown terrain pcode corner ${corner}.`);
	return index;
}
