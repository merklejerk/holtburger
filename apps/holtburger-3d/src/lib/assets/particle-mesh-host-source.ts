import type { DatAssetId } from "../game/game-types";
import { decodeParticleMeshRecord } from "./decode-particle-mesh-record";
import type { ParticleMeshSource } from "./particle-mesh-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for particle mesh resource closures. */
export class ParticleMeshHostSource implements ParticleMeshSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): ParticleMeshHostSource {
		return new ParticleMeshHostSource(transport);
	}

	async loadParticleMeshes(hwGfxObjIds: readonly DatAssetId[]) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load particle meshes from a destroyed host source.",
			);
		const response = await this.#transport.invoke("load_particle_meshes", {
			request: { hwGfxObjIds: [...hwGfxObjIds] },
		});
		return decodeParticleMeshRecord(
			asHostBinary(response, "Particle-mesh host command"),
		);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
