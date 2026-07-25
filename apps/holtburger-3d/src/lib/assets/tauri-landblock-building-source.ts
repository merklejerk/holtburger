import type { LandblockId } from "../game/game-types";
import type { ResolvedObjectLayerSource } from "../game/resolution/landblock-layer";
import { decodeBuildingSource } from "./decode-building-source";
import type { LandblockBuildingSource } from "./landblock-building-source";

/** Tauri adapter for the closed Level 1 building-source capability. */
export class TauriLandblockBuildingSource implements LandblockBuildingSource {
	static build(): TauriLandblockBuildingSource {
		return new TauriLandblockBuildingSource();
	}

	async loadBuildingSource(
		landblockId: LandblockId,
	): Promise<ResolvedObjectLayerSource | null> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_building_source", {
			request: { landblockId },
		});
		return decodeBuildingSource(asBinaryResponse(response), landblockId);
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
	throw new Error("Tauri returned a non-binary building source response.");
}
