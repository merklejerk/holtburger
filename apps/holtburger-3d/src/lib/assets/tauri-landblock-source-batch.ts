import type { LandblockId } from "../game/game-types";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceLayer,
} from "./landblock-source-batch";

/** Tauri adapter for one closed per-landblock source batch. */
export class TauriLandblockSourceBatch implements LandblockSourceBatchSource {
	readonly #activeRegion: ActiveRegionSource;

	protected constructor(activeRegion: ActiveRegionSource) {
		this.#activeRegion = activeRegion;
	}

	static build(activeRegion: ActiveRegionSource): TauriLandblockSourceBatch {
		return new TauriLandblockSourceBatch(activeRegion);
	}

	async loadLandblockSourceBatch(
		landblockId: LandblockId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_landblock_source_batch", {
			request: { landblockId, layers: [...layers] },
		});
		return decodeLandblockSourceBatch(
			asBinaryResponse(response),
			landblockId,
			layers,
			this.#activeRegion,
		);
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
	throw new Error("Tauri returned a non-binary landblock source batch.");
}
