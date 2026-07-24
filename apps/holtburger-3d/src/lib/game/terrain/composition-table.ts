import { ROAD_TERRAIN_TYPE, TERRAIN_TYPE_COUNT } from "./pcode";
import type {
	ResolvedTerrainTextureFacts,
	TerrainCompositionFacts,
	TerrainMaterialType,
} from "./types";

/** Fixed number of RGBA32UI rows in one compiled terrain composition lookup texture. */
export const TERRAIN_COMPOSITION_TABLE_HEIGHT = 6;

const TERRAIN_COMPOSITION_TABLE_COMPONENTS = 4;
const TERRAIN_TYPE_COLOR_ROW = 0;
const TERRAIN_TYPE_VARIATION_ROW = 1;
const CORNER_ALPHA_ROW = 2;
const SIDE_ALPHA_ROW = 3;
const ROAD_ALPHA_ROW = 4;
const METADATA_ROW = 5;

/** CPU upload payload for one stable regional RGBA32UI terrain lookup texture. */
export interface TerrainCompositionTable {
	readonly width: number;
	readonly texels: Uint32Array;
}

/** Compile regional source facts into the integer records consumed by the terrain program. */
export function compileTerrainCompositionTable(
	composition: TerrainCompositionFacts,
	textures: ResolvedTerrainTextureFacts,
): TerrainCompositionTable {
	const fallbackTerrain = composition.terrainTypes[0];
	if (!fallbackTerrain) {
		throw new Error(
			`Terrain active region ${composition.activeRegionKey} has no terrain descriptor fallback.`,
		);
	}
	const width = Math.max(
		TERRAIN_TYPE_COUNT + 1,
		composition.cornerTerrainAlphaMaps.length,
		composition.sideTerrainAlphaMaps.length,
		composition.roadAlphaMaps.length,
	);
	const texels = new Uint32Array(
		width *
			TERRAIN_COMPOSITION_TABLE_HEIGHT *
			TERRAIN_COMPOSITION_TABLE_COMPONENTS,
	);
	const colorLayers = createLayerMap(textures.colors.sourceAssetIds, "color");
	const blendMaskLayers = createLayerMap(
		textures.blendMasks.sourceAssetIds,
		"blend mask",
	);
	const roadMaskLayers = createLayerMap(
		textures.roadMasks.sourceAssetIds,
		"road mask",
	);

	for (
		let terrainType = 0;
		terrainType < TERRAIN_TYPE_COUNT;
		terrainType += 1
	) {
		writeTerrainType(
			texels,
			width,
			terrainType,
			findTerrainType(composition.terrainTypes, terrainType) ?? fallbackTerrain,
			colorLayers,
		);
	}
	writeTerrainType(
		texels,
		width,
		ROAD_TERRAIN_TYPE,
		findTerrainType(composition.terrainTypes, ROAD_TERRAIN_TYPE) ??
			fallbackTerrain,
		colorLayers,
	);

	for (const [index, map] of composition.cornerTerrainAlphaMaps.entries()) {
		writeRecord(texels, width, CORNER_ALPHA_ROW, index, [
			requireLayer(
				blendMaskLayers,
				map.blendMaskTextureId,
				"terrain blend mask",
			),
			map.terrainCode,
		]);
	}
	for (const [index, map] of composition.sideTerrainAlphaMaps.entries()) {
		writeRecord(texels, width, SIDE_ALPHA_ROW, index, [
			requireLayer(
				blendMaskLayers,
				map.blendMaskTextureId,
				"terrain blend mask",
			),
			map.terrainCode,
		]);
	}
	for (const [index, map] of composition.roadAlphaMaps.entries()) {
		writeRecord(texels, width, ROAD_ALPHA_ROW, index, [
			requireLayer(roadMaskLayers, map.roadMaskTextureId, "road mask"),
			map.roadCode,
		]);
	}
	writeRecord(texels, width, METADATA_ROW, 0, [
		composition.cornerTerrainAlphaMaps.length,
		composition.sideTerrainAlphaMaps.length,
		composition.roadAlphaMaps.length,
		composition.landscapeDetail.tiling,
	]);

	return { texels, width };
}

function writeTerrainType(
	texels: Uint32Array,
	width: number,
	column: number,
	terrain: TerrainMaterialType,
	colorLayers: ReadonlyMap<string, number>,
): void {
	writeRecord(texels, width, TERRAIN_TYPE_COLOR_ROW, column, [
		requireLayer(colorLayers, terrain.colorTextureId, "terrain color"),
		terrain.tiling,
		terrain.colorVariation.minVertexBrightness,
		terrain.colorVariation.maxVertexBrightness,
	]);
	writeRecord(texels, width, TERRAIN_TYPE_VARIATION_ROW, column, [
		terrain.colorVariation.minVertexSaturation,
		terrain.colorVariation.maxVertexSaturation,
		terrain.colorVariation.minVertexHue,
		terrain.colorVariation.maxVertexHue,
	]);
}

function writeRecord(
	texels: Uint32Array,
	width: number,
	row: number,
	column: number,
	values: readonly number[],
): void {
	const offset = (row * width + column) * TERRAIN_COMPOSITION_TABLE_COMPONENTS;
	for (let component = 0; component < values.length; component += 1) {
		texels[offset + component] = values[component];
	}
}

function createLayerMap(
	assetIds: readonly string[],
	label: string,
): ReadonlyMap<string, number> {
	if (assetIds.length === 0) {
		throw new Error(`Terrain ${label} array has no logical layers.`);
	}
	return new Map(assetIds.map((assetId, index) => [assetId, index]));
}

function requireLayer(
	layers: ReadonlyMap<string, number>,
	assetId: string,
	label: string,
): number {
	const layer = layers.get(assetId);
	if (layer === undefined) {
		throw new Error(`Terrain ${label} ${assetId} is missing from its array.`);
	}
	return layer;
}

function findTerrainType(
	terrainTypes: readonly TerrainMaterialType[],
	terrainType: number,
): TerrainMaterialType | undefined {
	return terrainTypes.find((entry) => entry.terrainType === terrainType);
}
