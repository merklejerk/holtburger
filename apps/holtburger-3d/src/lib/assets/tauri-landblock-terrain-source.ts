import type { LandblockId } from "../game/game-types";
import type { ResolvedTerrainLayerSource } from "../game/resolution/landblock-layer";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeTerrainSource } from "./decode-terrain-source";
import type { LandblockTerrainSource } from "./landblock-terrain-source";

/** Tauri adapter for the terrain-only static-content capability. */
export class TauriLandblockTerrainSource implements LandblockTerrainSource {
	readonly #activeRegion: ActiveRegionSource;

	protected constructor(activeRegion: ActiveRegionSource) {
		this.#activeRegion = activeRegion;
	}

	static build(activeRegion: ActiveRegionSource): TauriLandblockTerrainSource {
		return new TauriLandblockTerrainSource(activeRegion);
	}

	async loadTerrainSource(
		landblockId: LandblockId,
	): Promise<ResolvedTerrainLayerSource | null> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_terrain_source", {
			request: { landblockId },
		});
		return decodeTerrainSource(
			asBinaryResponse(response),
			landblockId,
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
	throw new Error("Tauri returned a non-binary terrain source response.");
}
