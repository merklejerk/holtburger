import { decodeSetupVisual } from "./decode-setup-visual";
import type { DecodedStaticPresentation } from "./decode-static-source-record";
import type {
	SetupVisualAppearance,
	SetupVisualSource,
} from "./setup-visual-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";
import { HostRequestGate } from "../host/host-request-gate";

/** Keep a large replacement snapshot well below the sidecar's emergency pending-request ceiling. */
export const MAX_SETUP_VISUAL_REQUESTS = 32;

/** Loads one exact source-neutral SetupModel appearance from the app-local content host. */
export class SetupVisualHostSource implements SetupVisualSource {
	readonly #transport: HostTransport;
	readonly #requests = new HostRequestGate(MAX_SETUP_VISUAL_REQUESTS);

	constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	async load(
		setupDid: number,
		appearance: SetupVisualAppearance,
	): Promise<DecodedStaticPresentation> {
		return this.#requests.schedule(async () => {
			const response = await this.#transport.invoke("load_setup_visual", {
				request: {
					appearance,
					setupDid,
				},
			});
			return decodeSetupVisual(
				asHostBinary(response, "Setup visual host command"),
			);
		});
	}

	destroy(): void {
		this.#requests.destroy();
	}
}
