import type { DatAssetId } from "../game/game-types";
import { decodeAudioRecord } from "./decode-audio-record";
import type { AudioAssetSource } from "./web-audio-device";

/** Narrow Tauri adapter for decoder-ready audio payloads. */
export class TauriAudioSource implements AudioAssetSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriAudioSource {
		return new TauriAudioSource();
	}

	async loadAudio(soundId: DatAssetId): Promise<ArrayBuffer> {
		if (this.#destroyed)
			throw new Error("Cannot load audio from a destroyed Tauri source.");
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_audio", {
			request: { soundId },
		});
		return decodeAudioRecord(asBinaryResponse(response), soundId).payload;
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
	throw new Error("Tauri returned a non-binary audio record.");
}
