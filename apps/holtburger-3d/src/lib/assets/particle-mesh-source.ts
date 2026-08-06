import type { DatAssetId } from "../game/game-types";
import type { ParticleMeshPresentations } from "./decode-particle-mesh-record";

/**
 * Host adapter boundary for particle mesh presentations.
 *
 * Batched because one script closure typically names several emitters, and a single closure lets
 * their shared geometry and materials dedupe rather than transferring the same buffers repeatedly.
 */
export interface ParticleMeshSource {
	loadParticleMeshes(
		hwGfxObjIds: readonly DatAssetId[],
	): Promise<ParticleMeshPresentations>;
	destroy(): void;
}
