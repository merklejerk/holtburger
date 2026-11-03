import { decodeSetupVisual } from "./decode-setup-visual";
import type { DecodedStaticPresentation } from "./decode-static-source-record";
import type {
	SetupVisualAppearance,
	SetupVisualSource,
} from "./setup-visual-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Loads one exact source-neutral SetupModel appearance from the app-local content host. */
export class SetupVisualHostSource implements SetupVisualSource {
	readonly #transport: HostTransport;
	/** Source lifetime is independent of the connection-wide content queue. */
	#destroyed = false;

	constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	async load(
		setupDid: number,
		appearance: SetupVisualAppearance,
	): Promise<DecodedStaticPresentation> {
		if (this.#destroyed) throw new Error("Setup visual source is stopped.");
		const response = await this.#transport.invoke("load_setup_visual", {
			request: {
				appearance,
				setupDid,
			},
		});
		return decodeSetupVisual(
			asHostBinary(response, "Setup visual host command"),
		);
	}

	destroy(): void {
		this.#destroyed = true;
	}
}
