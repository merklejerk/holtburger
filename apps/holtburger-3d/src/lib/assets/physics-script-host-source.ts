import type { DatAssetId } from "../game/game-types";
import { decodePhysicsScriptRecord } from "./decode-physics-script-record";
import type { PhysicsScriptSource } from "./physics-script-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for typed immutable physics-script records. */
export class PhysicsScriptHostSource implements PhysicsScriptSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): PhysicsScriptHostSource {
		return new PhysicsScriptHostSource(transport);
	}

	async loadPhysicsScript(scriptId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a physics script from a destroyed host source.",
			);
		const response = await this.#transport.invoke("load_physics_script", {
			request: { scriptId },
		});
		return decodePhysicsScriptRecord(
			asHostBinary(response, "Physics-script host command"),
			scriptId,
		);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
