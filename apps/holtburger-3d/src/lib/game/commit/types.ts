import type { DatAssetId, EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Mat4 } from "../math/types";
import type { ColorF } from "../pixels/types";
import type { ScenePlacement } from "../scene";
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

export enum TextureWrapPolicy {
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
	colorWrapS: TextureWrapPolicy;
	colorWrapT: TextureWrapPolicy;
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
	colorWrapS: TextureWrapPolicy;
	colorWrapT: TextureWrapPolicy;
	instanceData: Array<{
		transform: Mat4;
		color: ColorF;
	}>;
} & ColorTextureVariant;

export interface InstancedStaticData {
	vertexData: Float32Array;
	indexData: Uint32Array;
	patches: StaticInstancePatchData[];
}

export interface EnvCellInfo {
	id: EnvCellId;
	bounds: AABB3;
	bsp: unknown;
}

/** Visual source facts needed to prepare a dynamic scene node. */
export interface DynamicVisualSource {
	readonly sourceAssetId: DatAssetId;
	readonly setupModelId: DatAssetId;
	readonly defaultAnimationId: DatAssetId | null;
}

/** Materialization input for one dynamic entity emitted by a layer commit. */
export interface DynamicEntityCommit {
	/** Visual assets consumed by the renderer bridge. */
	readonly visual: DynamicVisualSource;
	/** Root placement consumed by the scene graph. */
	readonly placement: ScenePlacement;
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

export interface EnvCellPortalInfo {
	kind: EnvCellPortalKind;
	bounds: AABB3;
}

export type StaticLandblockLayerCommitBuildings = BakedStaticDrawUnitsData;
export type StaticLandblockLayerCommitObjects = BakedStaticDrawUnitsData;
export type StaticLandblockLayerCommitGenerated = InstancedStaticData;
export interface StaticLandblockLayerCommitEnvCells {
	cells: EnvCellInfo[];
	// Keyed by cells index.
	cellPortalsByIndex: EnvCellPortals[];
	// Keyed by cells index.
	cellDrawUnitsByIndex: BakedStaticDrawUnitsData[];
	portals: EnvCellPortalInfo[];
	portalsVertexData: Float32Array;
	portalsIndexData: Uint32Array;
	portalsDrawRangesByKind: Map<
		EnvCellPortalKind,
		{
			indexStart: number;
			indexEnd: number;
		}
	>;
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
	/** Dynamic entities promoted out of this static layer. */
	dynamicEntities: readonly DynamicEntityCommit[];
}

export interface CommitBundleSpawnFields {
	kind: CommitBundleSourceKind.Spawned;
	id: string;
	/** Root placement facts required before the spawned node can enter the graph. */
	placement: ScenePlacement;
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
	| CommitBundleSpawnFields
);

export interface CommitPipeline {
	prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]>;
}
