import type { EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Mat4 } from "../math/types";
import type { ColorF } from "../pixels/types";
import type {
	LandblockIdLayer,
	LandblockLayerKind,
} from "../runtime/scene-interest";
import type {
	AtlasPageId,
	TexturePlacement as TextureAtlasPlacement,
} from "../textures/atlas-manager";
import type {
	TextureKey,
	TexturePixelFormat,
	TexturePurpose,
} from "../textures/types";

export enum TextureAtlasScope {
	Terrain,
	Buildings,
	Objects,
	Generated,
	EnvCells,
	ManualSpawn,
}

export interface TerrainFeatures {
	roadMaskTexture: TextureKey;
	colorTextures: TextureKey[];
	detailTexture: TextureKey;
}

export interface StaticLandblockLayerCommitTerrain {
	// Features shared by multiple points.
	features: TerrainFeatures[];
	// linearized grid heights.
	heights: Float32Array;
	// linearized terrain feature index.
	featureIndexes: Uint8Array;
}

export enum TextureWrapPolcy {
	Wrap,
	Clamp,
	Repeat,
}

export type ColorTextureVariant =
	| {
			directColorTexture: TextureKey;
	  }
	| {
			indexedColorTexture: TextureKey;
			paletteTexture: TextureKey;
	  };

export type StaticDrawUnitData = {
	indexStart: number;
	indexEnd: number;
	color: ColorF;
	detailTexture: TextureKey | null;
	colorWrapS: TextureWrapPolcy;
	colorWrapT: TextureWrapPolcy;
} & ColorTextureVariant;

export interface BakedStaticDrawUnitsData {
	vertexData: Float32Array;
	indexData: Uint32Array;
	drawUnits: StaticDrawUnitData[];
}

export type StaticInstancePatchData = {
	indexStart: number;
	indexEnd: number;
	detailTexture: TextureKey | null;
	colorWrapS: TextureWrapPolcy;
	colorWrapT: TextureWrapPolcy;
	instanceData: Array<{
		transform: Mat4;
		color: ColorF;
	}>;
} & ColorTextureVariant;

export interface InstancedStaticData {
	verexData: Float32Array;
	indexData: Uint32Array;
	patches: StaticInstancePatchData;
}

export interface EnvCellInfo {
	id: EnvCellId;
	bounds: AABB3;
	bsp: unknown;
}

export interface EnvCellPortals {
	inPortalIdxs: number[];
	outPortalIdxs: number[];
}

export enum EnvCellPortalKind {
	OutdoorToIndoor,
	IndoorToOutdoor,
	IndoorToIndoor,
}

interface EnvCellPortalInfo {
	kind: EnvCellPortalKind;
	bounds: AABB3;
}

export type StaticLandblockLayerCommitBuildings = BakedStaticDrawUnitsData;
export type StaticLandblockLayerCommitObjects = BakedStaticDrawUnitsData;
export type StaticLandblockLayerCommitGenerated = InstancedStaticData;
export interface StaticLandblockLayerCommitEnvCells {
	cells: EnvCellInfo[];
	// Keyed by cells index.
	cellPortals: EnvCellPortals[];
	// Keyed by cells index.
	cellDrawUnits: BakedStaticDrawUnitsData[];
	portals: EnvCellPortalInfo[];
	portalsVertexData: Float32Array;
	portalsIndexData: Uint32Array;
	portalsDrawRangesByKind: {
		[k in keyof EnvCellPortalKind]?: {
			indexStart: number;
			indexEnd: number;
		};
	};
}

export interface TextureAtlasPageCommit {
	pageId: AtlasPageId;
	width: number;
	height: number;
	format: TexturePixelFormat;
	purpose: TexturePurpose;
	pageBits: Uint8Array;
	textures: Array<{
		key: TextureKey;
		placement: TextureAtlasPlacement;
	}>;
}

export enum CommitBundleSourceKind {
	LandblockLayer,
	Spawned,
}

export interface CommitBundleLandblockLayerFields<
	TLayerKind extends LandblockLayerKind,
	TLayerCommit,
> {
	kind: CommitBundleSourceKind.LandblockLayer;
	landblockId: LandblockId;
	layer: TLayerKind;
	commit: TLayerCommit;
}

export interface CommitBundleManualFields {
	kind: CommitBundleSourceKind.Spawned;
	id: string;
	commit: unknown;
}

export type CommitBundle = {
	atlasPages: TextureAtlasPageCommit[];
} & (
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Terrain,
			StaticLandblockLayerCommitTerrain
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Buildings,
			StaticLandblockLayerCommitBuildings
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Objects,
			StaticLandblockLayerCommitObjects
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Generated,
			StaticLandblockLayerCommitGenerated
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.EnvCells,
			StaticLandblockLayerCommitEnvCells
	  >
	| CommitBundleManualFields
);

export interface CommitPipeline {
	prepareLandblockLayers(layers: Set<LandblockIdLayer>): Promise<CommitBundle>;
}
