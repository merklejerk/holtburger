import type { LandblockOwnerId } from "../game-types";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import type {
	LandblockIdLayer,
	LandblockLayerKind,
	OutdoorStaticLayerKind,
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
export interface StaticObjectLayerSourceCommit<
	TLayer extends OutdoorStaticLayerKind,
> {
	readonly source: Extract<
		ResolvedOutdoorStaticLayerSource,
		{ readonly kind: TLayer }
	>;
}

/** Closed EnvCell source plan awaiting revision-owned runtime realization. */
export interface EnvCellLayerSourceCommit {
	readonly plan: EnvCellMaterializationPlan;
}

export interface LandblockLayerCommitFields<
	TLayerKind extends LandblockLayerKind,
	TLayerCommit,
> {
	landblockId: LandblockOwnerId;
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
			StaticObjectLayerSourceCommit<LandblockLayerKind.Buildings>
	  >
	| LandblockLayerCommitFields<
			LandblockLayerKind.Objects,
			StaticObjectLayerSourceCommit<LandblockLayerKind.Objects>
	  >
	| LandblockLayerCommitFields<
			LandblockLayerKind.Generated,
			StaticObjectLayerSourceCommit<LandblockLayerKind.Generated>
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
