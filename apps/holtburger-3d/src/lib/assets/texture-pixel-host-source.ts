import type { TexturePixelSource } from "./texture-pixel-source";
import { decodeTexturePixels } from "./decode-texture-pixels";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for the terrain texture-pixel capability. */
export class TexturePixelHostSource implements TexturePixelSource {
	readonly #transport: HostTransport;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): TexturePixelHostSource {
		return new TexturePixelHostSource(transport);
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		const response = await this.#transport.invoke("load_texture_pixels", {
			request,
		});
		return decodeTexturePixels(
			asHostBinary(response, "Texture-pixel host command"),
			request,
		);
	}
}
