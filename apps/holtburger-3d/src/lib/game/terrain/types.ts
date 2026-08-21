import type { DatAssetId, LandblockId } from "../game-types";
import type { TerrainGeometryKey } from "../geometry/types";
import {
	type LandblockCoordinates,
	OUTDOOR_TERRAIN_GRID_CELLS,
} from "../landblocks";
import type { AABB3 } from "../math/types";
import type { TerrainGeometryData } from "../renderer/geometry";
import {
	createAssetTextureKey,
	createTerrainCompositionTextureKey,
	createTerrainSurfaceTextureKey,
	createTextureArrayKey,
	TexturePurpose,
	type AssetTextureFact,
	type AssetTextureKey,
	type TerrainCompositionTextureKey,
	type TerrainSurfaceTextureKey,
	type TextureArrayFact,
	type TextureArrayKey,
	type TerrainColorTextureArrayFact,
} from "../textures/types";
import {
	TERRAIN_COLOR_CODES,
	TERRAIN_MATERIAL_CODES,
	type TerrainMaterialCode,
} from "./pcode";

/** Number of canonical authored cells along either outdoor landblock terrain axis. */
export const TERRAIN_GRID_CELLS = OUTDOOR_TERRAIN_GRID_CELLS;

/** Source-proven color variation parameters for one terrain type. */
export interface TerrainColorVariation {
	readonly minVertexBrightness: number;
	readonly maxVertexBrightness: number;
	readonly minVertexSaturation: number;
	readonly maxVertexSaturation: number;
	readonly minVertexHue: number;
	readonly maxVertexHue: number;
}

/** One terrain type selected by the terrain portion of a landscape pcode. */
export interface TerrainMaterialType {
	readonly terrainType: number;
	readonly colorTextureId: DatAssetId;
	readonly tiling: number;
	readonly colorVariation: TerrainColorVariation;
}

/** Authored terrain descriptors and their complete fallback-resolved code lookup. */
export interface TerrainMaterialTable {
	/** Source descriptors in active-region order; index zero owns missing-code fallback policy. */
	readonly authored: readonly TerrainMaterialType[];
	/** One resolved descriptor for each near-composition terrain code, including road type 0x20. */
	readonly byCode: Readonly<Record<TerrainMaterialCode, TerrainMaterialType>>;
}

/** One canonical terrain-overlay alpha map selected and rotated from a terrain pcode. */
export interface TerrainAlphaMap {
	readonly terrainCode: number;
	readonly blendMaskTextureId: DatAssetId;
}

/** One canonical road alpha map selected and rotated from the road portion of a terrain pcode. */
export interface TerrainRoadAlphaMap {
	readonly roadCode: number;
	readonly roadMaskTextureId: DatAssetId;
}

/** Region-level landscape detail source retained independently of terrain arrays. */
export interface TerrainLandscapeDetail {
	readonly textureId: DatAssetId;
	readonly tiling: number;
}

/** Complete regional composition table interpreted by terrain presentation. */
export interface TerrainCompositionFacts {
	/** Immutable active-region provenance used only for renderer resource ownership. */
	readonly activeRegionKey: string;
	readonly terrainMaterials: TerrainMaterialTable;
	readonly cornerTerrainAlphaMaps: readonly TerrainAlphaMap[];
	readonly sideTerrainAlphaMaps: readonly TerrainAlphaMap[];
	readonly roadAlphaMaps: readonly TerrainRoadAlphaMap[];
	readonly landscapeDetail: TerrainLandscapeDetail;
}

/** Canonical landblock facts sufficient for one complete terrain-generation job. */
export interface TerrainGenerationSource {
	/** Outdoor landblock identity. */
	readonly landblockId: LandblockId;
	/** Number of authored vertices on each terrain-grid axis. */
	readonly gridSize: number;
	/** World-space distance between adjacent authored terrain vertices. */
	readonly tileSize: number;
	/** Authored region height-table indices in canonical row-major order. */
	readonly heightIndices: Uint8Array;
	/** Region-table-resolved world-space heights in canonical row-major order. */
	readonly heights: Float32Array;
	/** Raw CellLandblock 9x9 terrain samples, including terrain and road pcode bits. */
	readonly terrainSamples: Uint16Array;
	/** Host-computed retail diagonal bits for the row-major 8x8 authored cell grid. */
	readonly cellDiagonals: Uint8Array;
}

/** Stable regional texture identities required by one terrain source. */
export interface ResolvedTerrainTextureFacts {
	readonly colors: TerrainColorTextureArrayFact;
	readonly blendMasks: TextureArrayFact;
	readonly roadMasks: TextureArrayFact;
	readonly detail: AssetTextureFact;
}

/** Stable regional presentation facts retained beside one generated terrain source. */
export interface TerrainPresentationSource {
	readonly composition: TerrainCompositionFacts;
	/** Regional lookup payload compiled once, never during individual landblock publication. */
	readonly compositionTable: import("./composition-table").TerrainCompositionTable;
	readonly textures: ResolvedTerrainTextureFacts;
}

/** Stable texture identities retained beside a generated landblock installation. */
export interface TerrainTextureKeys {
	readonly colors: TextureArrayKey;
	readonly blendMasks: TextureArrayKey;
	readonly roadMasks: TextureArrayKey;
	readonly detail: AssetTextureKey;
}

/** Stable generated texture identities retained for one terrain source installation. */
export interface TerrainGeneratedTextureKeys {
	readonly composition: TerrainCompositionTextureKey;
	readonly surfaceField: TerrainSurfaceTextureKey;
}

/** The generated per-cell terrain pcode field for one landblock. */
export interface TerrainPcodeField {
	/** Generated-cell width; terrain uses the authored cell count on each axis. */
	readonly width: number;
	/** Generated-cell height; terrain uses the authored cell count on each axis. */
	readonly height: number;
	/** Row-major generated pcodes, one 32-bit entry per terrain quad. */
	readonly cellPcodes: Uint32Array;
}

/** Complete immutable CPU result of one landblock-local terrain-generation job. */
export interface TerrainGenerationResult {
	readonly geometry: TerrainGeometryData;
	/** Landblock-local bounds of the generated mesh. */
	readonly bounds: AABB3;
	readonly surfaceField: TerrainPcodeField;
}

/** Generation and presentation facts installed under one interested landblock. */
export interface TerrainSourceInstallation {
	readonly landblockId: LandblockId;
	readonly generation: TerrainGenerationSource;
	readonly presentation: TerrainPresentationSource;
}

/** Terrain-generation output retained after source-owned geometry publication. */
export interface RealizedTerrainResources {
	/** Landblock-local bounds of the generated mesh, published to the scene graph. */
	readonly bounds: AABB3;
}

/** One selected terrain submission ready for renderer resource resolution and drawing. */
export interface TerrainDrawUnit {
	/** Landblock containing this intrinsically landblock-local terrain geometry. */
	readonly landblockId: LandblockId;
	readonly coordinates: LandblockCoordinates;
	readonly geometry: TerrainGeometryKey;
	readonly surfaceField: TerrainSurfaceTextureKey;
	readonly textures: TerrainTextureKeys;
	/** Stable regional lookup texture interpreted by the terrain fragment program. */
	readonly composition: TerrainCompositionTextureKey;
}

/** Create deterministic texture facts from one source-proven regional composition table. */
export function resolveTerrainTextureFacts(
	composition: TerrainCompositionFacts,
): ResolvedTerrainTextureFacts {
	const arrayIdentity = `terrain-active-region:${composition.activeRegionKey}`;
	const sourceAssetIdsByTerrainCode = TERRAIN_COLOR_CODES.map(
		(terrainCode) =>
			composition.terrainMaterials.byCode[terrainCode].colorTextureId,
	);
	return {
		colors: {
			kind: "array",
			key: createTextureArrayKey(TexturePurpose.TerrainColor, arrayIdentity),
			purpose: TexturePurpose.TerrainColor,
			sourceAssetIds: uniqueTextureIds(
				TERRAIN_MATERIAL_CODES.map(
					(terrainCode) =>
						composition.terrainMaterials.byCode[terrainCode].colorTextureId,
				),
			),
			sourceAssetIdsByTerrainCode,
		},
		blendMasks: createTextureArrayFact(
			TexturePurpose.TerrainBlendMask,
			arrayIdentity,
			uniqueTextureIds([
				...composition.cornerTerrainAlphaMaps.map(
					({ blendMaskTextureId }) => blendMaskTextureId,
				),
				...composition.sideTerrainAlphaMaps.map(
					({ blendMaskTextureId }) => blendMaskTextureId,
				),
			]),
		),
		roadMasks: createTextureArrayFact(
			TexturePurpose.TerrainRoadMask,
			arrayIdentity,
			uniqueTextureIds(
				composition.roadAlphaMaps.map(
					({ roadMaskTextureId }) => roadMaskTextureId,
				),
			),
		),
		detail: {
			kind: "asset",
			key: createAssetTextureKey(
				TexturePurpose.TerrainDetail,
				composition.landscapeDetail.textureId,
			),
			purpose: TexturePurpose.TerrainDetail,
			sourceAssetId: composition.landscapeDetail.textureId,
		},
	};
}

/** Extract compact texture keys retained by runtime terrain state. */
export function terrainTextureKeysFromFacts(
	facts: ResolvedTerrainTextureFacts,
): TerrainTextureKeys {
	return {
		blendMasks: facts.blendMasks.key,
		colors: facts.colors.key,
		detail: facts.detail.key,
		roadMasks: facts.roadMasks.key,
	};
}

/** Derive every generated texture identity deterministically from one terrain source. */
export function terrainGeneratedTextureKeys(
	landblockId: LandblockId,
	presentation: TerrainPresentationSource,
): TerrainGeneratedTextureKeys {
	return {
		composition: createTerrainCompositionTextureKey(
			presentation.composition.activeRegionKey,
		),
		surfaceField: createTerrainSurfaceTextureKey(landblockId),
	};
}

function createTextureArrayFact(
	purpose: TexturePurpose.TerrainBlendMask | TexturePurpose.TerrainRoadMask,
	arrayIdentity: string,
	sourceAssetIds: readonly DatAssetId[],
): TextureArrayFact {
	if (sourceAssetIds.length === 0) {
		throw new Error(`Terrain ${purpose} array cannot be empty.`);
	}
	return {
		kind: "array",
		key: createTextureArrayKey(purpose, arrayIdentity),
		purpose,
		sourceAssetIds,
	};
}

function uniqueTextureIds(ids: readonly DatAssetId[]): readonly DatAssetId[] {
	return [...new Set(ids)];
}
