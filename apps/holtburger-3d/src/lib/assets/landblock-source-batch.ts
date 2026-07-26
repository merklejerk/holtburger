import type { LandblockId } from "../game/game-types";
import type {
	ResolvedObjectLayerSource,
	ResolvedTerrainLayerSource,
} from "../game/resolution/landblock-layer";
import { LandblockLayerKind } from "../game/runtime/scene-interest";

/** Layers supported by the app's current outdoor landblock source transport. */
export type LandblockSourceLayer =
	| LandblockLayerKind.Terrain
	| LandblockLayerKind.Buildings
	| LandblockLayerKind.Objects;

/** One decoded, requested record from a landblock source batch. */
export type LandblockSourceRecord =
	| ResolvedTerrainLayerSource
	| ResolvedObjectLayerSource
	| null;

/** Closed host capability for one landblock's complete requested source-layer set. */
export interface LandblockSourceBatchSource {
	loadLandblockSourceBatch(
		landblockId: LandblockId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch>;
}

/** The independently decoded records projected from one cumulative host acquisition. */
export interface LandblockSourceBatch {
	readonly landblockId: LandblockId;
	readonly records: ReadonlyMap<LandblockSourceLayer, LandblockSourceRecord>;
}
