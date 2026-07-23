import type { LandblockId } from "../game/game-types";
import type { ResolvedTerrainLayerSource } from "../game/resolution/landblock-layer";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";
import { decodeTerrainSource } from "./decode-terrain-source";
import { decodeTexturePixels } from "./decode-texture-pixels";
import type { LandblockTerrainSource } from "./landblock-terrain-source";
import type { TexturePixelSource } from "./texture-pixel-source";

/** Browser-compatible adapter for the same binary terrain content contracts used by Tauri. */
export class HttpTerrainContentSource
	implements LandblockTerrainSource, TexturePixelSource
{
	readonly #baseUrl: URL;

	private constructor(baseUrl: URL) {
		this.#baseUrl = baseUrl;
	}

	static build(baseUrl: string): HttpTerrainContentSource {
		let parsed: URL;
		try {
			parsed = new URL(baseUrl);
		} catch {
			throw new Error(`Terrain content host URL is invalid: ${baseUrl}.`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Terrain content host URL must use HTTP or HTTPS.");
		}
		return new HttpTerrainContentSource(parsed);
	}

	async loadTerrainSource(
		landblockId: LandblockId,
	): Promise<ResolvedTerrainLayerSource | null> {
		const bytes = await this.#postBinary("terrain-source", { landblockId });
		return decodeTerrainSource(bytes, landblockId);
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		const bytes = await this.#postBinary("texture-pixels", request);
		return decodeTexturePixels(bytes, request);
	}

	async #postBinary(path: string, body: unknown): Promise<Uint8Array> {
		const response = await fetch(new URL(path, this.#baseUrl), {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		if (!response.ok) {
			throw new Error(
				`Terrain content host ${path} failed (${response.status}): ${await response.text()}`,
			);
		}
		return new Uint8Array(await response.arrayBuffer());
	}
}
