import type { LandblockOwnerId } from "../game/game-types";
import { normalizeLandblockOwner } from "../game/landblocks";
import {
	decodeLandblockProfile,
	type LandblockProfile,
	type LandblockProfileSource,
} from "./landblock-profile-source";
import type { HostTransport } from "../host/host-transport";

/** Host adapter for the shallow landblock profile capability. */
export class LandblockProfileHostSource implements LandblockProfileSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): LandblockProfileHostSource {
		return new LandblockProfileHostSource(transport);
	}

	async loadLandblockProfile(
		landblockId: LandblockOwnerId,
	): Promise<LandblockProfile | null> {
		if (this.#destroyed) {
			throw new Error(
				"Cannot load a landblock profile from a destroyed host source.",
			);
		}
		const owner = normalizeLandblockOwner(landblockId);
		const response = await this.#transport.invoke("load_landblock_profile", {
			request: { landblockId: owner },
		});
		return decodeLandblockProfile(response, owner);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
