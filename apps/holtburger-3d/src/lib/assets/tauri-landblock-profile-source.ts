import type { LandblockId } from "../game/game-types";
import { normalizeLandblockOwner } from "../game/landblocks";
import {
	decodeLandblockProfile,
	type LandblockProfile,
	type LandblockProfileSource,
} from "./landblock-profile-source";

/** Tauri adapter for the shallow landblock profile capability. */
export class TauriLandblockProfileSource implements LandblockProfileSource {
	#destroyed = false;

	protected constructor() {}

	static build(): TauriLandblockProfileSource {
		return new TauriLandblockProfileSource();
	}

	async loadLandblockProfile(
		landblockId: LandblockId,
	): Promise<LandblockProfile | null> {
		if (this.#destroyed) {
			throw new Error(
				"Cannot load a landblock profile from a destroyed Tauri source.",
			);
		}
		const owner = normalizeLandblockOwner(landblockId);
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_landblock_profile", {
			request: { landblockId: owner },
		});
		return decodeLandblockProfile(response, owner);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
