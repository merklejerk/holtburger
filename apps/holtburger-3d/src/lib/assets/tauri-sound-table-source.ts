import type { DatAssetId } from "../game/game-types";
import { decodeSoundTableRecord } from "./decode-sound-table-record";
import type { SoundTableSource } from "./sound-table-source";

/** Narrow Tauri adapter for typed immutable sound tables. */
export class TauriSoundTableSource implements SoundTableSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriSoundTableSource {
		return new TauriSoundTableSource();
	}

	async loadSoundTable(soundTableId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a sound table from a destroyed Tauri source.",
			);
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_sound_table", {
			request: { soundTableId },
		});
		return decodeSoundTableRecord(asBinaryResponse(response), soundTableId);
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
	throw new Error("Tauri returned a non-binary sound-table record.");
}
