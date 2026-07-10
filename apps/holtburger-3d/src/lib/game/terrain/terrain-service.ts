import type { StaticLandblockLayerCommitTerrain } from "../commit/types";
import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";

/** Terrain-specific residency policy passed from the game runtime. */
export interface TerrainResidencyConfig {
	readonly landblockRadius: number;
}

/** Camera and policy inputs used to select generated terrain tiles. */
export interface TerrainResidencyInput {
	readonly camera: Camera;
	readonly config: TerrainResidencyConfig;
}

/** Generated landblock mesh identity until renderer payloads are defined. */
export interface TerrainMeshArtifact {
	readonly landblockId: LandblockId;
	readonly generation: number;
}

/** Scene changes emitted when landblock mesh residency changes. */
export type TerrainSceneChange =
	| {
			readonly kind: "upsert-landblock-mesh";
			readonly mesh: TerrainMeshArtifact;
	  }
	| {
			readonly kind: "remove-landblock-mesh";
			readonly landblockId: LandblockId;
	  };

export class TerrainService {
	readonly #sources = new Map<LandblockId, StaticLandblockLayerCommitTerrain>();
	#sceneChanges: TerrainSceneChange[] = [];

	installSource(
		landblockId: LandblockId,
		source: StaticLandblockLayerCommitTerrain,
	): void {
		this.#sources.set(landblockId, source);
	}

	removeSource(landblockId: LandblockId): void {
		this.#sources.delete(landblockId);
		this.#sceneChanges.push({
			kind: "remove-landblock-mesh",
			landblockId,
		});
	}

	updateResidency(input: TerrainResidencyInput): void {
		// TODO: select, generate, and retain terrain tiles from canonical sources.
		void input;
	}

	drainSceneChanges(): readonly TerrainSceneChange[] {
		const changes = this.#sceneChanges;
		this.#sceneChanges = [];
		return changes;
	}
}
