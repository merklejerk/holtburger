import type { DatAssetId } from "../game/game-types";
import type { DecodedParticleEmitterInfo } from "./decode-particle-emitter-record";

/** Host adapter boundary for immutable decoded DAT particle-emitter definitions. */
export interface ParticleEmitterSource {
	loadParticleEmitter(
		emitterInfoId: DatAssetId,
	): Promise<DecodedParticleEmitterInfo>;
	destroy(): void;
}
