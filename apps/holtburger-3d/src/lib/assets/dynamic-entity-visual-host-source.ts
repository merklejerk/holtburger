import type { DynamicEntityView } from "../game/runtime/dynamic-entity-feed";
import { decodeDynamicEntityVisual } from "./decode-dynamic-entity-visual";
import type { DecodedStaticPresentation } from "./decode-static-source-record";
import type { DynamicEntityVisualSource } from "./dynamic-entity-visual-source";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Loads one exact source-neutral entity appearance from the app-local content host. */
export class DynamicEntityVisualHostSource implements DynamicEntityVisualSource {
	readonly #transport: HostTransport;

	constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	async load(
		presentation: DynamicEntityView["presentation"],
	): Promise<DecodedStaticPresentation> {
		const response = await this.#transport.invoke(
			"load_dynamic_entity_visual",
			{
				request: {
					appearance: presentation.appearance,
					setupDid: presentation.content.setupDid,
				},
			},
		);
		return decodeDynamicEntityVisual(
			asHostBinary(response, "Dynamic-entity visual host command"),
		);
	}
}
