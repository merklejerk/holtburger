import type { DatAssetId } from "../game/game-types";
import type { AnimationAssetSource } from "./animation-asset-source";
import { decodeAnimationRecord } from "./decode-animation-record";

/** Narrow Tauri adapter for typed immutable animation records. */
export class TauriAnimationAssetSource implements AnimationAssetSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriAnimationAssetSource {
		return new TauriAnimationAssetSource();
	}

	async loadAnimation(animationId: DatAssetId) {
		if (this.#destroyed)
			throw new Error("Cannot load animation from a destroyed Tauri source.");
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_animation", {
			request: { animationId },
		});
		return decodeAnimationRecord(asBinaryResponse(response), animationId);
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
	throw new Error("Tauri returned a non-binary animation record.");
}
