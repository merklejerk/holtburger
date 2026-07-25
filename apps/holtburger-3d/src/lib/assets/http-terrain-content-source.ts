import type { LandblockId } from "../game/game-types";
import type { ResolvedTerrainLayerSource } from "../game/resolution/landblock-layer";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";
import { decodeTerrainSource } from "./decode-terrain-source";
import {
	decodeActiveRegionSource,
	type ActiveRegionSource,
} from "./active-region-source";
import { decodeTexturePixels } from "./decode-texture-pixels";
import type { LandblockTerrainSource } from "./landblock-terrain-source";
import type { LandblockBuildingSource } from "./landblock-building-source";
import { decodeBuildingSource } from "./decode-building-source";
import type { TexturePixelSource } from "./texture-pixel-source";
import type { ResolvedObjectLayerSource } from "../game/resolution/landblock-layer";

/** Browser-compatible adapter for the same binary terrain content contracts used by Tauri. */
export class HttpTerrainContentSource
	implements LandblockTerrainSource, LandblockBuildingSource, TexturePixelSource
{
	readonly #baseUrl: URL;
	readonly #activeRegion: ActiveRegionSource;

	private constructor(baseUrl: URL, activeRegion: ActiveRegionSource) {
		this.#baseUrl = baseUrl;
		this.#activeRegion = activeRegion;
	}

	static async build(baseUrl: string): Promise<HttpTerrainContentSource> {
		let parsed: URL;
		try {
			parsed = new URL(baseUrl);
		} catch {
			throw new Error(`Terrain content host URL is invalid: ${baseUrl}.`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Terrain content host URL must use HTTP or HTTPS.");
		}
		const activeRegion = decodeActiveRegionSource(
			await postBinary(parsed, "active-region-data", {}),
		);
		return new HttpTerrainContentSource(parsed, activeRegion);
	}

	async loadTerrainSource(
		landblockId: LandblockId,
	): Promise<ResolvedTerrainLayerSource | null> {
		const bytes = await this.#postBinary("terrain-source", { landblockId });
		return decodeTerrainSource(bytes, landblockId, this.#activeRegion);
	}

	async loadBuildingSource(
		landblockId: LandblockId,
	): Promise<ResolvedObjectLayerSource | null> {
		return decodeBuildingSource(
			await this.#postBinary("building-source", { landblockId }),
			landblockId,
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
			`Terrain content host ${path} failed (${response.status}): ${await response.text()}`,
		);
	}
	return new Uint8Array(await response.arrayBuffer());
}
