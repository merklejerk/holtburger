import type { StaticLandblockLayerCommitTerrain } from "../commit/types";
import type { LandblockId } from "../game-types";
import type { AABB3 } from "../math/types";
import type { TerrainGeometryData } from "../renderer/geometry";
import type { Camera } from "../runtime/types";
import type { TextureKey } from "../textures/types";

/** Camera and policy inputs used to select generated landblock meshes. */
export interface TerrainResidencyInput {
	readonly camera: Camera;
	readonly landblockRadius: number;
}

/** Inputs controlling regeneration of one complete landblock mesh. */
export interface TerrainGenerationPolicy {
	readonly subdivisionLevel: number;
}

/** Material range within one generated terrain index buffer. */
export interface TerrainMaterialPatch {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly colorTexture: TextureKey;
	readonly detailTexture: TextureKey;
	readonly roadMaskTexture: TextureKey;
}

/** Renderer-independent CPU mesh generated for one complete landblock. */
export interface TerrainMeshArtifact {
	readonly landblockId: LandblockId;
	readonly sourceRevision: number;
	readonly policy: TerrainGenerationPolicy;
	readonly bounds: AABB3;
	readonly geometry: TerrainGeometryData;
	readonly patches: readonly TerrainMaterialPatch[];
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
		// TODO: select, generate, and retain whole-landblock meshes from canonical sources.
		void input;
	}

	drainSceneChanges(): readonly TerrainSceneChange[] {
		const changes = this.#sceneChanges;
		this.#sceneChanges = [];
		return changes;
	}
}
