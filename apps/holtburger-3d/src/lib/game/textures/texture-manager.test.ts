import { describe, expect, it } from "vitest";
import { AABB2, Vec2 } from "../math/types";
import type { RenderGeometryData } from "../renderer/geometry";
import {
	type GeometryResourceKey,
	type RendererResourceManager,
	type RenderResourceKey,
	type TerrainCompositionResourceKey,
	type TerrainSurfaceResourceKey,
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
import type { TerrainSurfaceField } from "../terrain/types";

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
		const textures = new TextureManager(resources);
		const page = createPage();

		textures.upsertAtlasPage(PAGE_ID, page);

		expect(textures.getAtlasBinding(page.textures[0].key)).toEqual({
			placement: page.textures[0].placement,
			resource: "texture-2d-resource:0",
		});
	});

	it("creates and publishes one complete immutable texture array", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
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
		const textures = new TextureManager(resources);
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
		const textures = new TextureManager(resources);

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
		const textures = new TextureManager(resources);
		const source = createArraySource();

		expect(textures.createTextureArray(source)).toBe(true);
		expect(textures.createTextureArray(source)).toBe(false);
		expect(resources.arrayDescriptions).toHaveLength(1);
		expect(resources.arrayUploads).toHaveLength(2);
	});

	it("releases a partial device resource when array creation fails", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
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
		const textures = new TextureManager(resources);

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
		const textures = new TextureManager(resources);
		textures.createTextureArray(createArraySource());

		expect(textures.releaseTexture(ARRAY_KEY)).toBe(true);
		expect(textures.releaseTexture(ARRAY_KEY)).toBe(false);
		expect(resources.releasedResources).toEqual(["texture-array-resource:0"]);
	});

	it("releases a standalone texture as one logical texture", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		textures.createStandaloneTexture(createStandaloneSource());

		expect(textures.releaseTexture(STANDALONE_KEY)).toBe(true);
		expect(textures.releaseTexture(STANDALONE_KEY)).toBe(false);
		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});
});

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

	createTerrainSurface(field: TerrainSurfaceField): TerrainSurfaceResourceKey {
		void field;
		throw new Error("Terrain surfaces are not used by texture manager tests.");
	}

	createTerrainComposition(): TerrainCompositionResourceKey {
		throw new Error(
			"Terrain composition tables are not used by texture manager tests.",
		);
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
