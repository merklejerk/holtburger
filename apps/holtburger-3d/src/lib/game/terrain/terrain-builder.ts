import type { StaticLandblockLayerCommitTerrain } from "../commit/types";
import type { LandblockId } from "../game-types";

export class TerrainBuilder {
	upsert(landblockId: LandblockId, commit: StaticLandblockLayerCommitTerrain) {
		void landblockId;
		void commit;
		// ...
	}

	drop(landblockId: LandblockId) {
		void landblockId;
		// ...
	}
}
