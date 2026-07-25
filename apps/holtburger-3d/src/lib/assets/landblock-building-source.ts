import type { LandblockId } from "../game/game-types";
import type { ResolvedObjectLayerSource } from "../game/resolution/landblock-layer";

/** Narrow host capability for one closed Level 1 outdoor-building source bundle. */
export interface LandblockBuildingSource {
	loadBuildingSource(
		landblockId: LandblockId,
	): Promise<ResolvedObjectLayerSource | null>;
}
