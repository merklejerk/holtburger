import type { DatAssetId, LandblockId } from "../game-types";
import type { TerrainGeometryKey } from "../geometry/types";
import { getLandblockCoordinates } from "../landblocks";
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
} from "../textures/types";

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
	readonly regionNumber: number;
	readonly terrainTypes: readonly TerrainMaterialType[];
	readonly cornerTerrainAlphaMaps: readonly TerrainAlphaMap[];
	readonly sideTerrainAlphaMaps: readonly TerrainAlphaMap[];
	readonly roadAlphaMaps: readonly TerrainRoadAlphaMap[];
	readonly landscapeDetail: TerrainLandscapeDetail;
}

/** Canonical landblock facts sufficient for one complete terrain-generation job. */
export interface TerrainGenerationSource {
	/** Raw CellLandblock 9x9 height bytes; workers apply the retail height table. */
	readonly heightBytes: Uint8Array;
	/** Raw CellLandblock 9x9 terrain samples, including terrain and road pcode bits. */
	readonly terrainSamples: Uint16Array;
}

/** Stable regional texture identities required by one terrain source. */
export interface ResolvedTerrainTextureFacts {
	readonly colors: TextureArrayFact;
	readonly blendMasks: TextureArrayFact;
	readonly roadMasks: TextureArrayFact;
	readonly detail: AssetTextureFact;
}

/** Stable regional presentation facts retained beside one generated terrain source. */
export interface TerrainPresentationSource {
	readonly composition: TerrainCompositionFacts;
	readonly textures: ResolvedTerrainTextureFacts;
}

/** Stable texture identities retained beside a generated landblock installation. */
export interface TerrainTextureKeys {
	readonly colors: TextureArrayKey;
	readonly blendMasks: TextureArrayKey;
	readonly roadMasks: TextureArrayKey;
	readonly detail: AssetTextureKey;
}

/** Authored-grid sampling stride used to generate one retail terrain LOD. */
export type TerrainMeshStride = 1 | 2 | 4 | 8;

/** Every authored-grid stride generated and retained for one terrain landblock. */
export const TERRAIN_MESH_STRIDES: readonly TerrainMeshStride[] = [1, 2, 4, 8];

/** Stable generated texture identities retained for one terrain source installation. */
export interface TerrainGeneratedTextureKeys {
	readonly composition: TerrainCompositionTextureKey;
	readonly surfaceFields: ReadonlyMap<
		TerrainMeshStride,
		TerrainSurfaceTextureKey
	>;
}

/** Retail transition orientation selected relative to the scene anchor. */
export type TerrainTransitionDirection =
	| "viewer-block"
	| "north"
	| "northeast"
	| "east"
	| "southeast"
	| "south"
	| "southwest"
	| "west"
	| "northwest";

/** One generated per-cell pcode field shared by every directional variant of a stride. */
export interface TerrainSurfaceField {
	readonly stride: TerrainMeshStride;
	/** Generated-cell width; retail terrain uses 8/stride cells on each axis. */
	readonly width: number;
	/** Generated-cell height; retail terrain uses 8/stride cells on each axis. */
	readonly height: number;
	/** Row-major generated pcodes, one 32-bit entry per generated terrain quad. */
	readonly cellPcodes: Uint32Array;
}

/** LOD and transition adjustment selected from scene-anchor-relative policy. */
export interface TerrainVariant {
	readonly stride: TerrainMeshStride;
	readonly transitionDirection: TerrainTransitionDirection;
}

/** Indexed slice containing one terrain variant in concatenated geometry. */
export interface TerrainVariantDrawRange {
	readonly variant: TerrainVariant;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly bounds: AABB3;
}

/** Complete immutable CPU result of one landblock-local terrain-generation job. */
export interface TerrainGenerationResult {
	readonly geometry: TerrainGeometryData;
	readonly variants: readonly TerrainVariantDrawRange[];
	readonly surfaceFields: readonly TerrainSurfaceField[];
}

/** Generation and presentation facts installed under one interested landblock. */
export interface TerrainSourceInstallation {
	readonly landblockId: LandblockId;
	readonly generation: TerrainGenerationSource;
	readonly presentation: TerrainPresentationSource;
}

/** Terrain-generation output retained after source-owned geometry publication. */
export interface RealizedTerrainResources {
	readonly variants: readonly TerrainVariantDrawRange[];
}

/** One selected terrain submission ready for renderer resource resolution and drawing. */
export interface TerrainDrawUnit {
	/** Landblock containing this intrinsically landblock-local terrain geometry. */
	readonly landblockId: LandblockId;
	readonly geometry: TerrainGeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly surfaceField: TerrainSurfaceTextureKey;
	readonly textures: TerrainTextureKeys;
	/** Stable regional lookup texture interpreted by the terrain fragment program. */
	readonly composition: TerrainCompositionTextureKey;
}

/** Create deterministic texture facts from one source-proven regional composition table. */
export function resolveTerrainTextureFacts(
	composition: TerrainCompositionFacts,
): ResolvedTerrainTextureFacts {
	const arrayIdentity = `terrain-region:${composition.regionNumber}`;
	return {
		colors: createTextureArrayFact(
			TexturePurpose.TerrainColor,
			arrayIdentity,
			uniqueTextureIds(
				composition.terrainTypes.map(({ colorTextureId }) => colorTextureId),
			),
		),
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
			presentation.composition.regionNumber,
		),
		surfaceFields: new Map(
			TERRAIN_MESH_STRIDES.map((stride) => [
				stride,
				createTerrainSurfaceTextureKey(landblockId, stride),
			]),
		),
	};
}

/** Select the retail authored-grid stride for a landblock relative to the scene anchor. */
export function selectTerrainMeshStride(
	landblockId: LandblockId,
	anchorLandblockId: LandblockId,
): TerrainMeshStride {
	const distance = landblockChebyshevDistance(landblockId, anchorLandblockId);
	if (distance <= 1) return 1;
	if (distance === 2) return 2;
	if (distance <= 4) return 4;
	return 8;
}

/** Select the retail transition orientation for a landblock relative to the scene anchor. */
export function selectTerrainTransitionDirection(
	landblockId: LandblockId,
	anchorLandblockId: LandblockId,
): TerrainTransitionDirection {
	const landblock = getLandblockCoordinates(landblockId);
	const anchor = getLandblockCoordinates(anchorLandblockId);
	const horizontal = Math.sign(landblock.x - anchor.x);
	// Encoded landblock Y grows toward negative render Z, opposite retail's grid Y.
	const vertical = Math.sign(anchor.y - landblock.y);
	if (horizontal === 0 && vertical === 0) return "viewer-block";
	if (vertical > 0) {
		if (horizontal < 0) return "northwest";
		if (horizontal > 0) return "northeast";
		return "north";
	}
	if (vertical < 0) {
		if (horizontal < 0) return "southwest";
		if (horizontal > 0) return "southeast";
		return "south";
	}
	return horizontal < 0 ? "west" : "east";
}

function createTextureArrayFact(
	purpose: TexturePurpose,
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

function landblockChebyshevDistance(
	landblockId: LandblockId,
	anchorLandblockId: LandblockId,
): number {
	const landblock = getLandblockCoordinates(landblockId);
	const anchor = getLandblockCoordinates(anchorLandblockId);
	return Math.max(
		Math.abs(landblock.x - anchor.x),
		Math.abs(landblock.y - anchor.y),
	);
}
