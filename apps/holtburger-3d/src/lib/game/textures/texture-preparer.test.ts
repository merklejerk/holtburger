import { describe, expect, it } from "vitest";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import {
	createAssetTextureKey,
	type AssetTextureFact,
	TexturePixelFormat,
	TexturePurpose,
} from "./types";
import {
	type PreparedTextureSurface,
	type TexturePreparationServiceRequest,
	type TexturePreparationServiceResponse,
	WorkerTexturePreparer,
} from "./texture-preparer";

const DETAIL_TEXTURE: AssetTextureFact = {
	kind: "asset",
	key: createAssetTextureKey(TexturePurpose.TerrainDetail, "0x05000004"),
	purpose: TexturePurpose.TerrainDetail,
	sourceAssetId: "0x05000004",
};

describe("WorkerTexturePreparer", () => {
	it("coalesces concurrent preparation for one stable texture key", async () => {
		const assets = new DeferredTexturePixelSource(createDetailSurface());
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

	it("requests an authored palette by resource id and a composition by identity", async () => {
		const composite = {
			identity: "palette-composite:04000001:04000abc+18+8",
			basePaletteId: "0x04000001",
			ranges: [
				{ replacementPaletteId: "0x04000abc", offset: 0x18, colorCount: 0x08 },
			],
		} as const;
		const assets = new RecordingTexturePixelSource();
		const preparer = await WorkerTexturePreparer.build(assets);

		await preparer.prepare({
			kind: "asset",
			key: createAssetTextureKey(TexturePurpose.ObjectPalette, "0x04000001"),
			purpose: TexturePurpose.ObjectPalette,
			sourceAssetId: "0x04000001",
		});
		await preparer.prepare({
			kind: "asset",
			key: createAssetTextureKey(
				TexturePurpose.ObjectPalette,
				composite.identity,
			),
			purpose: TexturePurpose.ObjectPalette,
			sourceAssetId: composite.identity,
			paletteComposite: composite,
		});

		expect(assets.requests).toEqual([
			{
				kind: "prepared-object-palette",
				purpose: TexturePurpose.ObjectPalette,
				sourceAssetId: "palette/0x04000001",
			},
			{
				kind: "prepared-object-palette",
				purpose: TexturePurpose.ObjectPalette,
				sourceAssetId: composite.identity,
				paletteComposite: composite,
			},
		]);
	});
});

/** Echoes each request back so the preparer's own identity validation stays in play. */
class RecordingTexturePixelSource implements TexturePixelSource {
	readonly requests: TexturePreparationServiceRequest[] = [];

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		this.requests.push(request);
		return {
			kind: request.kind,
			purpose: request.purpose,
			surface: {
				format: TexturePixelFormat.RGBA8,
				height: 1,
				pixels: new Uint8Array([1, 2, 3, 4]),
				sourceAssetId: request.sourceAssetId,
				width: 1,
			},
		};
	}
}

class DeferredTexturePixelSource implements TexturePixelSource {
	readonly requests: TexturePreparationServiceRequest[] = [];
	#resolve: (() => void) | undefined;
	readonly #surface: PreparedTextureSurface;
	readonly #requestComplete = new Promise<void>((resolve) => {
		this.#resolve = resolve;
	});

	constructor(surface: PreparedTextureSurface) {
		this.#surface = surface;
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
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
