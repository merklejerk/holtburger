import { describe, expect, it } from "vitest";
import type { AssetBridge } from "../../assets/asset-bridge";
import type { LandblockIdLayer } from "../runtime/scene-interest";
import type { ResolvedLandblockLayerSource } from "../resolution/landblock-layer";
import {
	createStandaloneTextureKey,
	type StandaloneTextureFact,
	TexturePixelFormat,
	TexturePurpose,
} from "./types";
import {
	type PreparedTextureSurface,
	WorkerTexturePreparer,
} from "./texture-preparer";

const DETAIL_TEXTURE: StandaloneTextureFact = {
	kind: "standalone",
	key: createStandaloneTextureKey(TexturePurpose.TerrainDetail, "0x05000004"),
	purpose: TexturePurpose.TerrainDetail,
	sourceAssetId: "0x05000004",
};

describe("WorkerTexturePreparer", () => {
	it("coalesces concurrent preparation for one stable texture key", async () => {
		const assets = new DeferredAssetBridge(createDetailSurface());
		const preparer = await WorkerTexturePreparer.build(assets);

		const first = preparer.prepare(DETAIL_TEXTURE);
		const second = preparer.prepare(DETAIL_TEXTURE);

		expect(assets.requests).toHaveLength(1);
		assets.resolveRequest();
		await expect(Promise.all([first, second])).resolves.toEqual([
			{
				height: 2,
				key: DETAIL_TEXTURE.key,
				pixels: new Uint8Array([1, 2, 3, 4]),
				purpose: TexturePurpose.TerrainDetail,
				sourceAssetId: "0x05000004",
				width: 2,
			},
			{
				height: 2,
				key: DETAIL_TEXTURE.key,
				pixels: new Uint8Array([1, 2, 3, 4]),
				purpose: TexturePurpose.TerrainDetail,
				sourceAssetId: "0x05000004",
				width: 2,
			},
		]);
	});
});

class DeferredAssetBridge implements AssetBridge {
	readonly requests = [];
	#resolve: (() => void) | undefined;
	readonly #surface: PreparedTextureSurface;
	readonly #requestComplete = new Promise<void>((resolve) => {
		this.#resolve = resolve;
	});

	constructor(surface: PreparedTextureSurface) {
		this.#surface = surface;
	}

	async resolveLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<ResolvedLandblockLayerSource> {
		throw new Error(`Unexpected landblock resolution for ${layer.id}.`);
	}

	async requestTexturePreparationAsset(request: {
		readonly kind: "prepared-texture-surface";
		readonly purpose: TexturePurpose;
		readonly sourceAssetId: string;
	}) {
		this.requests.push(request);
		await this.#requestComplete;
		return {
			kind: "prepared-texture-surface" as const,
			purpose: request.purpose,
			surface: this.#surface,
		};
	}

	resolveRequest(): void {
		if (!this.#resolve) throw new Error("Texture request was not pending.");
		this.#resolve();
		this.#resolve = undefined;
	}
}

function createDetailSurface(): PreparedTextureSurface {
	return {
		format: TexturePixelFormat.RGBA8,
		height: 2,
		pixels: new Uint8Array([1, 2, 3, 4]),
		sourceAssetId: "0x05000004",
		width: 2,
	};
}
