import type { LandblockId } from "../game-types";
import type { ResolvedObjectResident } from "../resolution/landblock-layer";
import type {
	LandblockIdLayer,
	LandblockLayerKind,
} from "../runtime/scene-interest";
import type {
	TexturePageId,
	TexturePlacement,
} from "../textures/texture-manager";
import type { AssetTextureKey, TexturePurpose } from "../textures/types";
import type { StaticObjectInstallSet } from "../systems/static-object-system";
import type { EnvCellSystemArtifact } from "../systems/env-cell-system";
import type {
	TerrainGenerationSource,
	TerrainPresentationSource,
} from "../terrain/types";

export interface StaticLandblockLayerCommitTerrain {
	/** Canonical source retained by runtime terrain generation. */
	readonly generation: TerrainGenerationSource;
	/** Stable regional composition and texture identities retained without decoded pixels. */
	readonly presentation: TerrainPresentationSource;
}

export enum TextureWrapPolicy {
	Wrap,
	Clamp,
	Repeat,
}

/** Resolved dynamic resident emitted beside a static layer commit. */
export type DynamicEntityCommit = ResolvedObjectResident;

/** Immutable object residents installed by their typed domain system. */
export interface StaticObjectLayerCommit {
	readonly staticObjects: StaticObjectInstallSet;
}

/** Topology and shell publication kept separate from embedded object residents. */
export interface EnvCellLayerCommit extends StaticObjectLayerCommit {
	readonly environment: EnvCellSystemArtifact;
}

export interface TexturePageCommit {
	pageId: TexturePageId;
	width: number;
	height: number;
	purpose: TexturePurpose;
	pageBits: Uint8Array;
	textures: Array<{
		key: AssetTextureKey;
		placement: TexturePlacement;
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
	/** Resolved entity routed through the same dynamic-system path as authored residents. */
	commit: DynamicEntityCommit;
}

export type CommitBundle = {} & (
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Terrain,
			StaticLandblockLayerCommitTerrain
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Buildings,
			StaticObjectLayerCommit
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Objects,
			StaticObjectLayerCommit
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Generated,
			StaticObjectLayerCommit
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.EnvCells,
			EnvCellLayerCommit
	  >
	| CommitBundleSpawnFields
);

export interface CommitPipeline {
	prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]>;
}
