import {
	decodeSkySourceRecord,
	type SkySourcePresentations,
} from "./decode-sky-record";
import type { SkySourceLoader } from "./sky-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter and runtime-scoped cache for the region's celestial resource set. */
export class SkyHostSource implements SkySourceLoader {
	readonly #transport: HostTransport;
	#loaded: Promise<SkySourcePresentations> | null = null;

	constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	/** Load once; the celestial resource set is immutable for the active region. */
	loadSkySource(): Promise<SkySourcePresentations> {
		this.#loaded ??= this.#loadFromHost();
		return this.#loaded;
	}

	/** Clear the frontend cache with the presentation owner that owned it. */
	destroy(): void {
		this.#loaded = null;
	}

	async #loadFromHost(): Promise<SkySourcePresentations> {
		const response = await this.#transport.invoke("load_sky_source");
		return decodeSkySourceRecord(asHostBinary(response, "Sky host command"));
	}
}
