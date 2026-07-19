import { describe, expect, it } from "vitest";
import { AABB2, Vec2 } from "../math/types";
import type { RenderGeometryData } from "../renderer/geometry";
import { IntegerTexture2DFormat } from "../renderer/resource-manager";
import {
	type GeometryResourceKey,
	type RendererResourceManager,
	type RenderResourceKey,
	type TextureArrayDescription,
	type TextureArrayLayerUpload,
	type TextureArrayResourceKey,
	type Texture2DResourceKey,
	type Texture2DUpload,
} from "../renderer/resource-manager";
import {
	createAtlasEntryKey,
	createStandaloneTextureKey,
	createTerrainSurfaceTextureKey,
	createTextureArrayKey,
	type TextureFact,
	TexturePixelFormat,
	type TexturePreparation,
	TexturePurpose,
	TextureWrapMode,
} from "./types";
import {
	TextureManager,
	type TexturePageDescription,
	type TexturePageId,
} from "./texture-manager";
import type { TexturePreparer } from "./texture-preparer";

const WRAPPED_ATLAS_PREPARATION: TexturePreparation = {
	gutterPixels: 4,
	wrap: TextureWrapMode.Repeat,
};
const ARRAY_KEY = createTextureArrayKey(
	TexturePurpose.TerrainColor,
	"region:dereth",
);
const STANDALONE_KEY = createStandaloneTextureKey(
	TexturePurpose.TerrainDetail,
	"0x05000004",
);
const ARRAY_FACT: TextureFact = {
	kind: "array",
	key: ARRAY_KEY,
	purpose: TexturePurpose.TerrainColor,
	sourceAssetIds: ["0x05000001", "0x05000002"],
};
const STANDALONE_FACT: TextureFact = {
	kind: "standalone",
	key: STANDALONE_KEY,
	purpose: TexturePurpose.TerrainDetail,
	sourceAssetId: "0x05000004",
};
const PAGE_ID: TexturePageId = "page:a";

describe("TextureManager", () => {
	it("retains packed atlas bindings", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const page = createPage();

		textures.installAtlasPage("objects:a", PAGE_ID, page);

		expect(textures.getAtlasBinding(page.textures[0].key)).toEqual({
			placement: page.textures[0].placement,
			resource: "texture-2d-resource:0",
		});
	});

	it("materializes one complete texture array through retained facts", async () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		await textures.retain("terrain:a", [ARRAY_FACT]);

		expect(textures.getTextureArrayBinding(ARRAY_KEY)).toEqual({
			layersByAssetId: new Map([
				["0x05000001", 0],
				["0x05000002", 1],
			]),
			resource: "texture-array-resource:0",
		});
		expect(resources.arrayDescriptions).toEqual([
			{
				format: TexturePixelFormat.RGBA8,
				height: 2,
				layerCapacity: 2,
				mipLevels: 2,
				width: 2,
			},
		]);
		expect(resources.arrayUploads).toEqual([
			{ key: "texture-array-resource:0", layer: 0, firstByte: 1 },
			{ key: "texture-array-resource:0", layer: 1, firstByte: 2 },
		]);
		expect(resources.mipmapGenerations).toEqual(["texture-array-resource:0"]);

		textures.dropOwner("terrain:a");
		expect(resources.releasedResources).toEqual(["texture-array-resource:0"]);
	});

	it("materializes one shared texture once and releases it after its final owner", async () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);

		await textures.retain("terrain:a", [STANDALONE_FACT]);
		await textures.retain("terrain:b", [STANDALONE_FACT]);
		expect(resources.texture2DUploads).toHaveLength(1);
		expect(textures.getTexture2DResource(STANDALONE_KEY)).toBe(
			"texture-2d-resource:0",
		);

		textures.dropOwner("terrain:a");
		expect(resources.releasedResources).toEqual([]);
		textures.dropOwner("terrain:b");
		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});

	it("retains every atlas entry through its owning page", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const page = createPage();

		textures.installAtlasPage("objects:a", PAGE_ID, page);
		textures.dropOwner("objects:a");

		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});

	it("materializes and releases a retained generated texture by its stable key", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const key = createTerrainSurfaceTextureKey("0x1111ffff", 1);
		const source = {
			key,
			upload: {
				data: new Uint32Array(64),
				format: IntegerTexture2DFormat.R32UI,
				height: 8,
				mipLevels: 1,
				width: 8,
			},
		};

		textures.reserveKeys("terrain:a", [key]);
		textures.upsertGeneratedTextures([source]);
		textures.upsertGeneratedTextures([source]);

		expect(textures.getTexture2DResource(key)).toBe("texture-2d-resource:0");
		expect(resources.texture2DUploads).toHaveLength(1);

		textures.dropOwner("terrain:a");
		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});
});

function createTextureManager(
	resources: RendererResourceManager,
): TextureManager<string> {
	return new TextureManager(resources, new FixtureTexturePreparer());
}

function createPage(): TexturePageDescription {
	return {
		height: 2,
		pageBits: createPixels(),
		purpose: TexturePurpose.ObjectDirectColor,
		textures: [
			{
				key: createAtlasEntryKey(
					TexturePurpose.ObjectDirectColor,
					"0x05000003",
					WRAPPED_ATLAS_PREPARATION,
				),
				placement: {
					bounds: new AABB2(new Vec2(0, 0), new Vec2(2, 2)),
					preparation: WRAPPED_ATLAS_PREPARATION,
				},
			},
		],
		width: 2,
	};
}

function createPixels(firstByte = 0): Uint8Array {
	const pixels = new Uint8Array(2 * 2 * 4);
	pixels[0] = firstByte;
	return pixels;
}

class FixtureTexturePreparer implements TexturePreparer {
	prepare(fact: TextureFact) {
		if (fact.kind === "standalone") {
			return Promise.resolve({
				height: 2,
				key: fact.key,
				pixels: createPixels(3),
				purpose: fact.purpose,
				sourceAssetId: fact.sourceAssetId,
				width: 2,
			});
		}
		return Promise.resolve({
			height: 2,
			key: fact.key,
			layers: fact.sourceAssetIds.map((sourceAssetId, index) => ({
				pixels: createPixels(index + 1),
				sourceAssetId,
			})),
			purpose: fact.purpose,
			width: 2,
		});
	}

	async destroy(): Promise<void> {}
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly arrayDescriptions: TextureArrayDescription[] = [];
	readonly arrayUploads: Array<{
		readonly key: TextureArrayResourceKey;
		readonly layer: number;
		readonly firstByte: number;
	}> = [];
	readonly mipmapGenerations: TextureArrayResourceKey[] = [];
	readonly releasedResources: RenderResourceKey[] = [];
	readonly texture2DUploads: Array<Omit<Texture2DUpload, "data">> = [];
	#nextTextureId = 0;
	#nextTextureArrayId = 0;

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		throw new Error("Geometry is not used by texture manager tests.");
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
		throw new Error("Geometry is not used by texture manager tests.");
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		this.texture2DUploads.push({
			format: upload.format,
			height: upload.height,
			mipLevels: upload.mipLevels,
			width: upload.width,
		});
		return `texture-2d-resource:${this.#nextTextureId++}`;
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		this.arrayDescriptions.push(description);
		return `texture-array-resource:${this.#nextTextureArrayId++}`;
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		this.arrayUploads.push({
			firstByte: upload.data[0],
			key,
			layer: upload.layer,
		});
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		this.mipmapGenerations.push(key);
	}

	releaseResource(key: RenderResourceKey): boolean {
		this.releasedResources.push(key);
		return true;
	}

	async destroy(): Promise<void> {}
}
