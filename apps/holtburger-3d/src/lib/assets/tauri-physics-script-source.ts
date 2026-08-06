import type { DatAssetId } from "../game/game-types";
import { decodePhysicsScriptRecord } from "./decode-physics-script-record";
import type { PhysicsScriptSource } from "./physics-script-source";

/** Narrow Tauri adapter for typed immutable physics-script records. */
export class TauriPhysicsScriptSource implements PhysicsScriptSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriPhysicsScriptSource {
		return new TauriPhysicsScriptSource();
	}

	async loadPhysicsScript(scriptId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a physics script from a destroyed Tauri source.",
			);
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_physics_script", {
			request: { scriptId },
		});
		return decodePhysicsScriptRecord(asBinaryResponse(response), scriptId);
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
	throw new Error("Tauri returned a non-binary physics-script record.");
}
