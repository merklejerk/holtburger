import type { DatAssetId } from "../game/game-types";
import { decodeParticleEmitterRecord } from "./decode-particle-emitter-record";
import type { ParticleEmitterSource } from "./particle-emitter-source";

/** Narrow Tauri adapter for typed immutable particle-emitter definitions. */
export class TauriParticleEmitterSource implements ParticleEmitterSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriParticleEmitterSource {
		return new TauriParticleEmitterSource();
	}

	async loadParticleEmitter(emitterInfoId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a particle emitter from a destroyed Tauri source.",
			);
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_particle_emitter", {
			request: { emitterInfoId },
		});
		return decodeParticleEmitterRecord(asBinaryResponse(response), emitterInfoId);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}

function asBinaryResponse(response: unknown): Uint8Array {
	if (response instanceof Uint8Array) return response;
	if (response instanceof ArrayBuffer) return new Uint8Array(response);
	if (
		Array.isArray(response) &&
		response.every((value) => Number.isInteger(value))
	) {
		return Uint8Array.from(response);
	}
	throw new Error("Tauri returned a non-binary particle-emitter record.");
}
