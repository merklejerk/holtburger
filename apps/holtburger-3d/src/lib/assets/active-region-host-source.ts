import {
	decodeActiveRegionSource,
	type ActiveRegionSource,
} from "./active-region-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter and runtime-scoped cache for the host-selected active region. */
export class ActiveRegionHostSource {
	readonly #transport: HostTransport;
	#loaded: Promise<ActiveRegionSource> | null = null;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): ActiveRegionHostSource {
		return new ActiveRegionHostSource(transport);
	}

	/** Load once; concurrent callers share the same immutable active-region value. */
	load(): Promise<ActiveRegionSource> {
		this.#loaded ??= this.#loadFromHost();
		return this.#loaded;
	}

	/** Clear the frontend cache with the presentation owner that owned it. */
	destroy(): void {
		this.#loaded = null;
	}

	async #loadFromHost(): Promise<ActiveRegionSource> {
		const response = await this.#transport.invoke("load_active_region_data");
		return decodeActiveRegionSource(
			asHostBinary(response, "Active-region host command"),
		);
	}
}
