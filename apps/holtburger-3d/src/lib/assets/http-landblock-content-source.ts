import type { LandblockId } from "../game/game-types";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";
import {
	decodeActiveRegionSource,
	type ActiveRegionSource,
} from "./active-region-source";
import { decodeTexturePixels } from "./decode-texture-pixels";
import type { TexturePixelSource } from "./texture-pixel-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceLayer,
} from "./landblock-source-batch";

/** Browser-compatible adapter for the same closed landblock batch contract used by Tauri. */
export class HttpLandblockContentSource
	implements LandblockSourceBatchSource, TexturePixelSource
{
	readonly #baseUrl: URL;
	readonly #activeRegion: ActiveRegionSource;

	private constructor(baseUrl: URL, activeRegion: ActiveRegionSource) {
		this.#baseUrl = baseUrl;
		this.#activeRegion = activeRegion;
	}

	static async build(baseUrl: string): Promise<HttpLandblockContentSource> {
		let parsed: URL;
		try {
			parsed = new URL(baseUrl);
		} catch {
			throw new Error(`Landblock content host URL is invalid: ${baseUrl}.`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Landblock content host URL must use HTTP or HTTPS.");
		}
		const activeRegion = decodeActiveRegionSource(
			await postBinary(parsed, "active-region-data", {}),
		);
		return new HttpLandblockContentSource(parsed, activeRegion);
	}

	/** Immutable active-region facts shared by terrain and outdoor-static presentation setup. */
	get activeRegion(): ActiveRegionSource {
		return this.#activeRegion;
	}

	async loadLandblockSourceBatch(
		landblockId: LandblockId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		return decodeLandblockSourceBatch(
			await this.#postBinary("landblock-source-batch", {
				landblockId,
				layers: [...layers],
			}),
			landblockId,
			layers,
			this.#activeRegion,
		);
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		const bytes = await this.#postBinary("texture-pixels", request);
		return decodeTexturePixels(bytes, request);
	}

	async #postBinary(path: string, body: unknown): Promise<Uint8Array> {
		return postBinary(this.#baseUrl, path, body);
	}
}

async function postBinary(
	baseUrl: URL,
	path: string,
	body: unknown,
): Promise<Uint8Array> {
	const response = await fetch(new URL(path, baseUrl), {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(
			`Landblock content host ${path} failed (${response.status}): ${await response.text()}`,
		);
	}
	return new Uint8Array(await response.arrayBuffer());
}
