import type { LandblockId } from "../game-types";
import type {
	ResolvedObjectLayerSource,
	ResolvedObjectResident,
} from "../resolution/landblock-layer";
import type {
	LandblockIdLayer,
	LandblockLayerKind,
} from "../runtime/scene-interest";
import type {
	TerrainGenerationSource,
	TerrainPresentationSource,
} from "../terrain/types";
import type {
	EnvCellLayerArtifact,
	StaticObjectLayerDiagnostics,
	StaticObjectLayerArtifact,
} from "./artifacts";

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
	/** Null when classification promoted every resident and no static resources were published. */
	readonly staticObjects: StaticObjectLayerArtifact | null;
	/** Optional source-to-bake snapshot emitted by static layers that expose diagnostics. */
	readonly diagnostics?: StaticObjectLayerDiagnostics;
}

/** Classified building source handed to runtime-owned static realization without physical pages. */
export interface BuildingLayerSourceCommit {
	readonly source: ResolvedObjectLayerSource;
}

/** Topology and shell publication kept separate from embedded object residents. */
export interface EnvCellLayerCommit extends StaticObjectLayerCommit {
	readonly environment: EnvCellLayerArtifact;
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
			BuildingLayerSourceCommit
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
