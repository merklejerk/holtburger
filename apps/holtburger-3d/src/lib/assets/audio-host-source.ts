import type { DatAssetId } from "../game/game-types";
import { decodeAudioRecord } from "./decode-audio-record";
import type { AudioAssetSource } from "./web-audio-device";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for decoder-ready audio payloads. */
export class AudioHostSource implements AudioAssetSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): AudioHostSource {
		return new AudioHostSource(transport);
	}

	async loadAudio(soundId: DatAssetId): Promise<ArrayBuffer> {
		if (this.#destroyed)
			throw new Error("Cannot load audio from a destroyed host source.");
		const response = await this.#transport.invoke("load_audio", {
			request: { soundId },
		});
		return decodeAudioRecord(
			asHostBinary(response, "Audio host command"),
			soundId,
		).payload;
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
