import type { TexturePixelSource } from "./texture-pixel-source";
import { decodeTexturePixels } from "./decode-texture-pixels";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";

/** Tauri adapter for the terrain texture-pixel capability. */
export class TauriTexturePixelSource implements TexturePixelSource {
	protected constructor() {}

	static build(): TauriTexturePixelSource {
		return new TauriTexturePixelSource();
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		const { invoke } = await import("@tauri-apps/api/core");
		const response = await invoke<unknown>("load_texture_pixels", { request });
		return decodeTexturePixels(asBinaryResponse(response), request);
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
	throw new Error("Tauri returned a non-binary texture-pixel response.");
}
