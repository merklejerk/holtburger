import { describe, expect, it } from "vitest";
import { AABB2, Vec2 } from "../math/types";
import type { RenderGeometryData } from "../renderer/geometry";
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
	createTextureArrayKey,
	type TextureFact,
	TexturePixelFormat,
	type TexturePreparation,
	TexturePurpose,
	TextureWrapMode,
} from "./types";
import {
	TextureManager,
	type StandaloneTextureSource,
	type TextureArraySource,
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
const PAGE_ID: TexturePageId = "page:a";

describe("TextureManager", () => {
	it("retains packed atlas bindings", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const page = createPage();

		textures.upsertAtlasPage(PAGE_ID, page);

		expect(textures.getAtlasBinding(page.textures[0].key)).toEqual({
			placement: page.textures[0].placement,
			resource: "texture-2d-resource:0",
		});
	});

	it("creates and publishes one complete immutable texture array", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const source = createArraySource();

		expect(textures.createTextureArray(source)).toBe(true);

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
	});

	it("creates and publishes one complete standalone texture", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const source = createStandaloneSource();

		expect(textures.createStandaloneTexture(source)).toBe(true);
		expect(textures.createStandaloneTexture(source)).toBe(false);
		expect(textures.getStandaloneTextureBinding(STANDALONE_KEY)).toEqual({
			resource: "texture-2d-resource:0",
		});
		expect(resources.texture2DUploads).toEqual([
			{
				format: TexturePixelFormat.RGBA8,
				height: 2,
				mipLevels: 2,
				width: 2,
			},
		]);
	});

	it("rejects invalid standalone texture sources before device allocation", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);

		expect(() =>
			textures.createStandaloneTexture({
				...createStandaloneSource(),
				purpose: TexturePurpose.TerrainColor,
			}),
		).toThrow("does not match its source facts");
		expect(resources.texture2DUploads).toEqual([]);
	});

	it("treats recreation from the same immutable source as idempotent", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const source = createArraySource();

		expect(textures.createTextureArray(source)).toBe(true);
		expect(textures.createTextureArray(source)).toBe(false);
		expect(resources.arrayDescriptions).toHaveLength(1);
		expect(resources.arrayUploads).toHaveLength(2);
	});

	it("releases a partial device resource when array creation fails", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		resources.failArrayLayer = 1;

		expect(() => textures.createTextureArray(createArraySource())).toThrow(
			"Fixture array upload failed",
		);
		expect(resources.releasedResources).toEqual(["texture-array-resource:0"]);
		expect(() => textures.getTextureArrayBinding(ARRAY_KEY)).toThrow(
			"does not exist",
		);
	});

	it("rejects invalid complete array sources before device allocation", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);

		expect(() =>
			textures.createTextureArray({ ...createArraySource(), layers: [] }),
		).toThrow("at least one layer");
		expect(() =>
			textures.createTextureArray({
				...createArraySource(),
				layers: [
					{ pixels: createPixels(1), sourceAssetId: "duplicate" },
					{ pixels: createPixels(2), sourceAssetId: "duplicate" },
				],
			}),
		).toThrow("duplicate DAT sources");
		expect(() =>
			textures.createTextureArray({
				...createArraySource(),
				purpose: TexturePurpose.TerrainBlendMask,
			}),
		).toThrow("does not match purpose");
		expect(resources.arrayDescriptions).toEqual([]);
	});

	it("releases a texture array as one logical texture", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		textures.createTextureArray(createArraySource());

		expect(textures.releaseTexture(ARRAY_KEY)).toBe(true);
		expect(textures.releaseTexture(ARRAY_KEY)).toBe(false);
		expect(resources.releasedResources).toEqual(["texture-array-resource:0"]);
	});

	it("releases a standalone texture as one logical texture", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		textures.createStandaloneTexture(createStandaloneSource());

		expect(textures.releaseTexture(STANDALONE_KEY)).toBe(true);
		expect(textures.releaseTexture(STANDALONE_KEY)).toBe(false);
		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});

	it("materializes one shared texture once and releases it after its final owner", async () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const fact: TextureFact = {
			kind: "standalone",
			key: STANDALONE_KEY,
			purpose: TexturePurpose.TerrainDetail,
			sourceAssetId: "0x05000004",
		};

		await textures.retain("terrain:a", [fact]);
		await textures.retain("terrain:b", [fact]);
		expect(resources.texture2DUploads).toHaveLength(1);

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
});

function createTextureManager(
	resources: RendererResourceManager,
): TextureManager<string> {
	return new TextureManager(resources, new FixtureTexturePreparer());
}

function createStandaloneSource(): StandaloneTextureSource {
	return {
		height: 2,
		key: STANDALONE_KEY,
		pixels: createPixels(3),
		purpose: TexturePurpose.TerrainDetail,
		sourceAssetId: "0x05000004",
		width: 2,
	};
}

function createArraySource(): TextureArraySource {
	return {
		height: 2,
		key: ARRAY_KEY,
		layers: [
			{ pixels: createPixels(1), sourceAssetId: "0x05000001" },
			{ pixels: createPixels(2), sourceAssetId: "0x05000002" },
		],
		purpose: TexturePurpose.TerrainColor,
		width: 2,
	};
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
				pixels: createPixels(index),
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
	failArrayLayer: number | null = null;
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
		if (upload.layer === this.failArrayLayer) {
			throw new Error("Fixture array upload failed.");
		}
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
