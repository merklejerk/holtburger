import type { DynamicEntityView } from "../game/runtime/dynamic-entity-feed";
import { decodeDynamicEntityVisual } from "./decode-dynamic-entity-visual";
import type { DecodedStaticPresentation } from "./decode-static-source-record";
import type { DynamicEntityVisualSource } from "./dynamic-entity-visual-source";

/** Loads one exact source-neutral entity appearance from the app-local content host. */
export class TauriDynamicEntityVisualSource implements DynamicEntityVisualSource {
	async load(
		presentation: DynamicEntityView["presentation"],
	): Promise<DecodedStaticPresentation> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_dynamic_entity_visual", {
			request: {
				appearance: presentation.appearance,
				setupDid: presentation.content.setupDid,
			},
		});
		return decodeDynamicEntityVisual(asBinaryResponse(response));
	}
}

function asBinaryResponse(response: unknown): Uint8Array {
	if (response instanceof Uint8Array) return response;
	if (response instanceof ArrayBuffer) return new Uint8Array(response);
	if (
		Array.isArray(response) &&
		response.every((value) => Number.isInteger(value))
	) {
		return Uint8Array.from(response);
	}
	throw new Error("Tauri returned a non-binary dynamic entity visual.");
}
