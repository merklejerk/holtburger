import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { DatAssetId, LandblockId } from "../game-types";
import {
	OUTDOOR_TERRAIN_GRID_SIZE,
	OUTDOOR_TERRAIN_TILE_SIZE,
} from "../landblocks";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import { LandblockLayerKind } from "../runtime/scene-interest";
import {
	resolveTerrainTextureFacts,
	type TerrainCompositionFacts,
} from "./types";

const DETAIL_ROLE_NAMES = [
	"landscape",
	"building",
	"environment",
	"object",
] as const;

/** One frontend-resolved terrain detail role retained from ordered TexMerge descriptors. */
export interface ResolvedRegionTerrainDetailRole {
	readonly role: (typeof DETAIL_ROLE_NAMES)[number];
	readonly sourceTerrainTextureIndex: number;
	readonly textureId: DatAssetId;
	readonly tiling: number;
}

/** Raw landblock facts transported independently of regional static presentation. */
export interface RawOutdoorTerrainSource {
	readonly landblockId: LandblockId;
	readonly heightIndices: Uint8Array;
	readonly heights: Float32Array;
	readonly terrainSamples: Uint16Array;
}

/** Resolve renderer-facing terrain facts from one raw landblock and installed active-region data. */
export function resolveOutdoorTerrainLayer(
	raw: RawOutdoorTerrainSource,
	activeRegion: ActiveRegionSource,
): ResolvedTerrainLayerSource {
	const expectedCount = OUTDOOR_TERRAIN_GRID_SIZE ** 2;
	if (
		raw.heightIndices.length !== expectedCount ||
		raw.heights.length !== expectedCount ||
		raw.terrainSamples.length !== expectedCount
	) {
		throw new Error(
			`Outdoor terrain ${raw.landblockId} must contain ${expectedCount} height indices and terrain samples.`,
		);
	}
	const presentation = resolveActiveRegionTerrainPresentation(activeRegion);
	for (const height of raw.heights) {
		if (!Number.isFinite(height)) {
			throw new Error(
				`Outdoor terrain ${raw.landblockId} contains a non-finite resolved height.`,
			);
		}
	}
	return {
		kind: LandblockLayerKind.Terrain,
		landblockId: raw.landblockId,
		generation: {
			gridSize: OUTDOOR_TERRAIN_GRID_SIZE,
			heightIndices: raw.heightIndices,
			heights: raw.heights,
			landblockId: raw.landblockId,
			terrainSamples: raw.terrainSamples,
			tileSize: OUTDOOR_TERRAIN_TILE_SIZE,
		},
		presentation: {
			composition: presentation.composition,
			textures: resolveTerrainTextureFacts(presentation.composition),
		},
	};
}

/** Port the existing Rust terrain projection from installed TexMerge records. */
export function resolveActiveRegionTerrainPresentation(
	activeRegion: ActiveRegionSource,
): {
	readonly composition: TerrainCompositionFacts;
	readonly detailRoles: readonly ResolvedRegionTerrainDetailRole[];
} {
	const terrain = activeRegion.data.terrain;
	if (terrain === null) {
		throw new Error("Installed active region has no terrain payload.");
	}
	if (terrain.landSurface.kind !== "texture-merge") {
		throw new Error(
			"Installed active region uses palette-shift terrain, which the WebGL terrain renderer does not support.",
		);
	}
	const textureMerge = terrain.landSurface;
	const detailRoles = textureMerge.terrainTextures
		.slice(0, DETAIL_ROLE_NAMES.length)
		.map((texture, sourceTerrainTextureIndex) => ({
			role: DETAIL_ROLE_NAMES[sourceTerrainTextureIndex]!,
			sourceTerrainTextureIndex,
			textureId: asSurfaceTextureAssetId(texture.detailTextureId),
			tiling: requirePositiveTiling(texture.detailTiling, "terrain detail"),
		}));
	const landscapeDetail = detailRoles[0];
	if (landscapeDetail === undefined) {
		throw new Error(
			"Installed active region has no landscape detail terrain descriptor.",
		);
	}
	const composition: TerrainCompositionFacts = {
		activeRegionKey: `${activeRegion.provenance.sourceRecordId}@${activeRegion.provenance.version}`,
		terrainTypes: textureMerge.terrainTextures.map((texture) => ({
			terrainType: texture.terrainType,
			colorTextureId: asSurfaceTextureAssetId(texture.colorTextureId),
			tiling: requirePositiveTiling(texture.tiling, "terrain color"),
			colorVariation: {
				minVertexBrightness: texture.minVertexBrightness,
				maxVertexBrightness: texture.maxVertexBrightness,
				minVertexSaturation: texture.minVertexSaturation,
				maxVertexSaturation: texture.maxVertexSaturation,
				minVertexHue: texture.minVertexHue,
				maxVertexHue: texture.maxVertexHue,
			},
		})),
		cornerTerrainAlphaMaps: textureMerge.cornerTerrainMaps.map((map) => ({
			terrainCode: map.terrainCode,
			blendMaskTextureId: asSurfaceTextureAssetId(map.surfaceTextureId),
		})),
		sideTerrainAlphaMaps: textureMerge.sideTerrainMaps.map((map) => ({
			terrainCode: map.terrainCode,
			blendMaskTextureId: asSurfaceTextureAssetId(map.surfaceTextureId),
		})),
		roadAlphaMaps: textureMerge.roadMaps.map((map) => ({
			roadCode: map.roadCode,
			roadMaskTextureId: asSurfaceTextureAssetId(map.surfaceTextureId),
		})),
		landscapeDetail: {
			textureId: landscapeDetail.textureId,
			tiling: landscapeDetail.tiling,
		},
	};
	return { composition, detailRoles };
}

function asSurfaceTextureAssetId(id: string): DatAssetId {
	if (!/^0x05[0-9a-f]{6}$/i.test(id)) {
		throw new Error(`Terrain reference ${id} is not a SurfaceTexture DAT ID.`);
	}
	return `surface-texture/${id.toLowerCase()}`;
}

function requirePositiveTiling(value: number, label: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(
			`Active-region ${label} tiling must be a positive integer.`,
		);
	}
	return value;
}
