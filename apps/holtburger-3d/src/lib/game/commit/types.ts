import type { LandblockId } from "../game-types";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
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

/** Classified outdoor-static source handed to runtime-owned realization without physical pages. */
export interface StaticObjectLayerSourceCommit {
	readonly source: ResolvedOutdoorStaticLayerSource;
}

/** Closed EnvCell source plan awaiting revision-owned runtime realization. */
export interface EnvCellLayerSourceCommit {
	readonly plan: EnvCellMaterializationPlan;
}

export interface LandblockLayerCommitFields<
	TLayerKind extends LandblockLayerKind,
	TLayerCommit,
> {
	landblockId: LandblockId;
	layer: TLayerKind;
	commit: TLayerCommit;
}

export type LandblockLayerCommit = {} & (
	| LandblockLayerCommitFields<
			LandblockLayerKind.Terrain,
			StaticLandblockLayerCommitTerrain
	  >
	| LandblockLayerCommitFields<
			LandblockLayerKind.Buildings,
			StaticObjectLayerSourceCommit
	  >
	| LandblockLayerCommitFields<
			LandblockLayerKind.Objects,
			StaticObjectLayerSourceCommit
	  >
	| LandblockLayerCommitFields<
			LandblockLayerKind.Generated,
			StaticObjectLayerSourceCommit
	  >
	| LandblockLayerCommitFields<
			LandblockLayerKind.EnvCells,
			EnvCellLayerSourceCommit
	  >
);

export interface CommitPipeline {
	prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly LandblockLayerCommit[]>;
}
