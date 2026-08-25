import type { DatAssetId } from "../game/game-types";
import { decodeParticleEmitterRecord } from "./decode-particle-emitter-record";
import type { ParticleEmitterSource } from "./particle-emitter-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for typed immutable particle-emitter definitions. */
export class ParticleEmitterHostSource implements ParticleEmitterSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): ParticleEmitterHostSource {
		return new ParticleEmitterHostSource(transport);
	}

	async loadParticleEmitter(emitterInfoId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a particle emitter from a destroyed host source.",
			);
		const response = await this.#transport.invoke("load_particle_emitter", {
			request: { emitterInfoId },
		});
		return decodeParticleEmitterRecord(
			asHostBinary(response, "Particle-emitter host command"),
			emitterInfoId,
		);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
