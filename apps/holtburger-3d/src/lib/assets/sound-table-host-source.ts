import type { DatAssetId } from "../game/game-types";
import { decodeSoundTableRecord } from "./decode-sound-table-record";
import type { SoundTableSource } from "./sound-table-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for typed immutable sound tables. */
export class SoundTableHostSource implements SoundTableSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): SoundTableHostSource {
		return new SoundTableHostSource(transport);
	}

	async loadSoundTable(soundTableId: DatAssetId) {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a sound table from a destroyed host source.",
			);
		const response = await this.#transport.invoke("load_sound_table", {
			request: { soundTableId },
		});
		return decodeSoundTableRecord(
			asHostBinary(response, "Sound-table host command"),
			soundTableId,
		);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
