import type { LandblockId } from "../game/game-types";
import type { ResolvedTerrainLayerSource } from "../game/resolution/landblock-layer";

/** Narrow host capability for immutable authored terrain facts of one outdoor landblock. */
export interface LandblockTerrainSource {
	loadTerrainSource(
		landblockId: LandblockId,
	): Promise<ResolvedTerrainLayerSource | null>;
}
