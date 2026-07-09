import { type LandblockId } from "../game-types";

export enum LandblockLayerKind {
	Terrain,
	Buildings,
	Objects,
	Generated,
	EnvCells,
}

export type SceneInterestMap = Map<LandblockId, Set<LandblockLayerKind>>;

export interface LandblockIdLayer {
	id: LandblockId;
	layer: LandblockLayerKind;
}

export interface SceneInterestDiff {
	newLayers: Set<LandblockIdLayer>;
	evictedLayers: Set<LandblockIdLayer>;
}

export function diffSceneInterest(
	from: SceneInterestMap,
	to: SceneInterestMap,
): SceneInterestDiff {
	// ...
}
