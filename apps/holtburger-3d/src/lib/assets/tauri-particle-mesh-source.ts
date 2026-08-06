import type { DatAssetId } from "../game/game-types";
import { decodeParticleMeshRecord } from "./decode-particle-mesh-record";
import type { ParticleMeshSource } from "./particle-mesh-source";

/** Narrow Tauri adapter for particle mesh resource closures. */
export class TauriParticleMeshSource implements ParticleMeshSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriParticleMeshSource {
		return new TauriParticleMeshSource();
	}

	async loadParticleMeshes(hwGfxObjIds: readonly DatAssetId[]) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load particle meshes from a destroyed Tauri source.",
			);
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_particle_meshes", {
			request: { hwGfxObjIds: [...hwGfxObjIds] },
		});
		return decodeParticleMeshRecord(asBinaryResponse(response));
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
	throw new Error("Tauri returned a non-binary particle-mesh record.");
}
