import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { DatAssetId, LandblockId } from "../game-types";
import {
	OUTDOOR_TERRAIN_GRID_CELLS,
	OUTDOOR_TERRAIN_GRID_SIZE,
	OUTDOOR_TERRAIN_TILE_SIZE,
} from "../landblocks";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import { LandblockLayerKind } from "../runtime/scene-interest";
import {
	resolveTerrainTextureFacts,
	type TerrainCompositionFacts,
	type TerrainMaterialType,
	type TerrainPresentationSource,
} from "./types";
import { compileTerrainCompositionTable } from "./composition-table";
import { resolveTerrainMaterialTable } from "./terrain-materials";

const DETAIL_ROLE_NAMES = [
	"landscape",
	"building",
	"environment",
	"object",
] as const;

const PRESENTATIONS_BY_ACTIVE_REGION = new WeakMap<
	ActiveRegionSource,
	ResolvedActiveRegionTerrainPresentation
>();
const DETAIL_ROLES_BY_ACTIVE_REGION = new WeakMap<
	ActiveRegionSource,
	ResolvedRegionTerrainDetailRoles
>();

/** Ordered detail roles with the required landscape role fixed at index zero. */
type ResolvedRegionTerrainDetailRoles = readonly [
	ResolvedRegionTerrainDetailRole,
	...ResolvedRegionTerrainDetailRole[],
];

/** Complete immutable terrain presentation derived once for one active-region source value. */
export interface ResolvedActiveRegionTerrainPresentation {
	readonly detailRoles: readonly ResolvedRegionTerrainDetailRole[];
	readonly terrain: TerrainPresentationSource;
}

/** One frontend-resolved terrain detail role retained from ordered TexMerge descriptors. */
interface ResolvedRegionTerrainDetailRole {
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
	/** Host-computed retail per-cell triangulation diagonals. */
	readonly cellDiagonals: Uint8Array;
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
	if (raw.cellDiagonals.length !== OUTDOOR_TERRAIN_GRID_CELLS ** 2) {
		throw new Error(
			`Outdoor terrain ${raw.landblockId} must contain ${OUTDOOR_TERRAIN_GRID_CELLS ** 2} cell diagonals.`,
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
			cellDiagonals: raw.cellDiagonals,
			gridSize: OUTDOOR_TERRAIN_GRID_SIZE,
			heightIndices: raw.heightIndices,
			heights: raw.heights,
			landblockId: raw.landblockId,
			terrainSamples: raw.terrainSamples,
			tileSize: OUTDOOR_TERRAIN_TILE_SIZE,
		},
		presentation: presentation.terrain,
	};
}

/** Resolve the ordered detail roles without requiring unrelated terrain composition arrays. */
export function resolveActiveRegionTerrainDetailRoles(
	activeRegion: ActiveRegionSource,
): ResolvedRegionTerrainDetailRoles {
	const existing = DETAIL_ROLES_BY_ACTIVE_REGION.get(activeRegion);
	if (existing) return existing;
	const textureMerge = requireTextureMerge(activeRegion);
	const detailRoles = DETAIL_ROLE_NAMES.flatMap(
		(role, sourceTerrainTextureIndex) => {
			const texture = textureMerge.terrainTextures[sourceTerrainTextureIndex];
			return texture === undefined
				? []
				: [
						{
							role,
							sourceTerrainTextureIndex,
							textureId: asSurfaceTextureAssetId(texture.detailTextureId),
							tiling: requirePositiveTiling(
								texture.detailTiling,
								"terrain detail",
							),
						},
					];
		},
	);
	const landscapeDetail = detailRoles[0];
	if (landscapeDetail === undefined) {
		throw new Error(
			"Installed active region has no landscape detail terrain descriptor.",
		);
	}
	const resolved: ResolvedRegionTerrainDetailRoles = Object.freeze([
		landscapeDetail,
		...detailRoles.slice(1),
	]);
	DETAIL_ROLES_BY_ACTIVE_REGION.set(activeRegion, resolved);
	return resolved;
}

/** Resolve the complete renderer-facing terrain presentation once per active-region value. */
export function resolveActiveRegionTerrainPresentation(
	activeRegion: ActiveRegionSource,
): ResolvedActiveRegionTerrainPresentation {
	const existing = PRESENTATIONS_BY_ACTIVE_REGION.get(activeRegion);
	if (existing) return existing;
	const textureMerge = requireTextureMerge(activeRegion);
	const detailRoles = resolveActiveRegionTerrainDetailRoles(activeRegion);
	const landscapeDetail = detailRoles[0];
	const authoredTerrainMaterials = textureMerge.terrainTextures.map(
		(texture): TerrainMaterialType => ({
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
		}),
	);
	const composition: TerrainCompositionFacts = {
		activeRegionKey: `${activeRegion.provenance.sourceRecordId}@${activeRegion.provenance.version}`,
		terrainMaterials: resolveTerrainMaterialTable(authoredTerrainMaterials),
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
	const textures = resolveTerrainTextureFacts(composition);
	const presentation = {
		detailRoles,
		terrain: {
			composition,
			compositionTable: compileTerrainCompositionTable(composition, textures),
			textures,
		},
	} as const;
	PRESENTATIONS_BY_ACTIVE_REGION.set(activeRegion, presentation);
	return presentation;
}

function requireTextureMerge(activeRegion: ActiveRegionSource) {
	const terrain = activeRegion.data.terrain;
	if (terrain === null) {
		throw new Error("Installed active region has no terrain payload.");
	}
	if (terrain.landSurface.kind !== "texture-merge") {
		throw new Error(
			"Installed active region uses palette-shift terrain, which the WebGL terrain renderer does not support.",
		);
	}
	return terrain.landSurface;
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
