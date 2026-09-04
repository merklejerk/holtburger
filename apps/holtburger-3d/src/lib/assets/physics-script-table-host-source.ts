import type { DatAssetId } from "../game/game-types";
import { asHostBinary } from "../host/binary-response";
import type { HostTransport } from "../host/host-transport";
import { decodePhysicsScriptTableRecord } from "./decode-physics-script-table-record";
import type { PhysicsScriptTableSource } from "./physics-script-table-source";

/** Host adapter for typed immutable PhysicsScriptTables. */
export class PhysicsScriptTableHostSource implements PhysicsScriptTableSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): PhysicsScriptTableHostSource {
		return new PhysicsScriptTableHostSource(transport);
	}

	async loadPhysicsScriptTable(physicsScriptTableId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a PhysicsScriptTable from a destroyed host source.",
			);
		const response = await this.#transport.invoke("load_physics_script_table", {
			request: { physicsScriptTableId },
		});
		return decodePhysicsScriptTableRecord(
			asHostBinary(response, "PhysicsScriptTable host command"),
			physicsScriptTableId,
		);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
