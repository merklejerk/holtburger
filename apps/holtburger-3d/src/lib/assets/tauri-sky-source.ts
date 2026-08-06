import {
	decodeSkySourceRecord,
	type SkySourcePresentations,
} from "./decode-sky-record";
import type { SkySourceLoader } from "./sky-source";

/** Tauri adapter and runtime-scoped cache for the region's celestial resource set. */
export class TauriSkySource implements SkySourceLoader {
	#loaded: Promise<SkySourcePresentations> | null = null;

	/** Load once; the celestial resource set is immutable for the active region. */
	loadSkySource(): Promise<SkySourcePresentations> {
		this.#loaded ??= this.#loadFromHost();
		return this.#loaded;
	}

	/** Clear the frontend cache with the Explorer runtime that owned it. */
	destroy(): void {
		this.#loaded = null;
	}

	async #loadFromHost(): Promise<SkySourcePresentations> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_sky_source");
		return decodeSkySourceRecord(asBinaryResponse(response));
	}
}

function asBinaryResponse(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry))) {
		return Uint8Array.from(value);
	}
	throw new Error("Sky source command returned a non-binary response.");
}
