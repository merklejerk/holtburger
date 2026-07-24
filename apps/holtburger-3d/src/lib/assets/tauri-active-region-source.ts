import {
	decodeActiveRegionSource,
	type ActiveRegionSource,
} from "./active-region-source";

/** Tauri adapter and runtime-scoped cache for the host-selected active region. */
export class TauriActiveRegionSource {
	#loaded: Promise<ActiveRegionSource> | null = null;

	protected constructor() {}

	static build(): TauriActiveRegionSource {
		return new TauriActiveRegionSource();
	}

	/** Load once; concurrent callers share the same immutable active-region value. */
	load(): Promise<ActiveRegionSource> {
		this.#loaded ??= this.#loadFromHost();
		return this.#loaded;
	}

	/** Clear the frontend cache with the Explorer runtime that owned it. */
	destroy(): void {
		this.#loaded = null;
	}

	async #loadFromHost(): Promise<ActiveRegionSource> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_active_region_data");
		return decodeActiveRegionSource(asBinaryResponse(response));
	}
}

function asBinaryResponse(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry))) {
		return Uint8Array.from(value);
	}
	throw new Error("Active-region command returned a non-binary response.");
}
