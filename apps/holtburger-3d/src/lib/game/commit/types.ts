import type { LandblockId } from "../game-types";
import type {
	ResolvedOutdoorStaticLayerSource,
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
import type { EnvCellMaterializationPlan } from "./env-cell-materialization";

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

/** Classified outdoor-static source handed to runtime-owned realization without physical pages. */
export interface StaticObjectLayerSourceCommit {
	readonly source: ResolvedOutdoorStaticLayerSource;
}

/** Closed EnvCell source plan awaiting revision-owned runtime realization. */
export interface EnvCellLayerSourceCommit {
	readonly plan: EnvCellMaterializationPlan;
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
			StaticObjectLayerSourceCommit
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Objects,
			StaticObjectLayerSourceCommit
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.Generated,
			StaticObjectLayerSourceCommit
	  >
	| CommitBundleLandblockLayerFields<
			LandblockLayerKind.EnvCells,
			EnvCellLayerSourceCommit
	  >
	| CommitBundleSpawnFields
);

export interface CommitPipeline {
	prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]>;
}
