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
	TextureArraySamplingPolicy,
	type Texture2DResourceKey,
	type Texture2DUpload,
} from "../renderer/resource-manager";
import { TextureGutterPolicy, type TextureKey, TexturePurpose } from "./types";
import {
	TextureManager,
	type ManagedTextureArrayDescription,
	type TextureArrayId,
	type TexturePageDescription,
	type TexturePageId,
} from "./texture-manager";

const ARRAY_ID: TextureArrayId = "texture-array:terrain-colors";
const PAGE_A: TexturePageId = "page:a";
const PAGE_B: TexturePageId = "page:b";
const TEXTURE_A: TextureKey = `${TexturePurpose.TerrainColor}:0x05000001/${TextureGutterPolicy.None}`;
const TEXTURE_B: TextureKey = `${TexturePurpose.TerrainColor}:0x05000002/${TextureGutterPolicy.None}`;

describe("TextureManager", () => {
	it("retains packed atlas bindings", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		const page = createPage(
			TexturePurpose.ObjectDirectColor,
			`${TexturePurpose.ObjectDirectColor}:0x05000003/${TextureGutterPolicy.Wrap4}`,
			TextureGutterPolicy.Wrap4,
		);

		textures.upsertAtlasPage(PAGE_A, page);

		expect(textures.getAtlasBinding(page.textures[0].key)).toEqual({
			placement: page.textures[0].placement,
			resource: "texture-2d-resource:0",
		});
	});

	it("assigns singleton pages to stable texture-array layers", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		textures.createTextureArray(ARRAY_ID, createArrayDescription(2));

		const first = textures.upsertTextureArrayPage(
			ARRAY_ID,
			PAGE_A,
			createPage(TexturePurpose.TerrainColor, TEXTURE_A),
		);
		const replacement = textures.upsertTextureArrayPage(
			ARRAY_ID,
			PAGE_A,
			createPage(TexturePurpose.TerrainColor, TEXTURE_A, undefined, 7),
		);

		expect(first).toEqual({
			layer: 0,
			resource: "texture-array-resource:0",
		});
		expect(replacement).toEqual(first);
		expect(textures.getTextureArrayBinding(TEXTURE_A)).toEqual(first);
		expect(resources.arrayUploads).toEqual([
			{ key: "texture-array-resource:0", layer: 0, firstByte: 0 },
			{ key: "texture-array-resource:0", layer: 0, firstByte: 7 },
		]);
	});

	it("reuses a released texture-array layer", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		textures.createTextureArray(ARRAY_ID, createArrayDescription(1));
		textures.upsertTextureArrayPage(
			ARRAY_ID,
			PAGE_A,
			createPage(TexturePurpose.TerrainColor, TEXTURE_A),
		);

		expect(textures.releaseTexture(TEXTURE_A)).toBe(true);
		expect(
			textures.upsertTextureArrayPage(
				ARRAY_ID,
				PAGE_B,
				createPage(TexturePurpose.TerrainColor, TEXTURE_B),
			),
		).toMatchObject({ layer: 0 });
	});

	it("returns a layer to the pool when its upload fails", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		textures.createTextureArray(ARRAY_ID, createArrayDescription(1));
		resources.failNextArrayUpload = true;

		expect(() =>
			textures.upsertTextureArrayPage(
				ARRAY_ID,
				PAGE_A,
				createPage(TexturePurpose.TerrainColor, TEXTURE_A),
			),
		).toThrow("Fixture array upload failed");
		expect(
			textures.upsertTextureArrayPage(
				ARRAY_ID,
				PAGE_B,
				createPage(TexturePurpose.TerrainColor, TEXTURE_B),
			),
		).toMatchObject({ layer: 0 });
	});

	it("rejects packed pages and gutters at the array boundary", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		textures.createTextureArray(ARRAY_ID, createArrayDescription(2));
		const packed = createPage(TexturePurpose.TerrainColor, TEXTURE_A);
		packed.textures.push({
			key: TEXTURE_B,
			placement: packed.textures[0].placement,
		});

		expect(() =>
			textures.upsertTextureArrayPage(ARRAY_ID, PAGE_A, packed),
		).toThrow("must contain exactly one texture");
		expect(() =>
			textures.upsertTextureArrayPage(
				ARRAY_ID,
				PAGE_A,
				createPage(
					TexturePurpose.TerrainColor,
					TEXTURE_A,
					TextureGutterPolicy.Wrap4,
				),
			),
		).toThrow("cannot contain a gutter");
	});

	it("prevents one texture key from entering both storage strategies", () => {
		const resources = new FakeRendererResourceManager();
		const textures = new TextureManager(resources);
		textures.createTextureArray(ARRAY_ID, createArrayDescription(1));
		textures.upsertTextureArrayPage(
			ARRAY_ID,
			PAGE_A,
			createPage(TexturePurpose.TerrainColor, TEXTURE_A),
		);

		expect(() =>
			textures.upsertAtlasPage(
				PAGE_B,
				createPage(TexturePurpose.TerrainColor, TEXTURE_A),
			),
		).toThrow("already has a different storage owner");
	});
});

function createArrayDescription(
	layerCapacity: number,
): ManagedTextureArrayDescription {
	return {
		height: 2,
		layerCapacity,
		mipLevels: 1,
		purpose: TexturePurpose.TerrainColor,
		sampling: TextureArraySamplingPolicy.LinearRepeat,
		width: 2,
	};
}

function createPage(
	purpose: TexturePurpose,
	key: TextureKey,
	gutter = TextureGutterPolicy.None,
	firstByte = 0,
): TexturePageDescription & {
	textures: Array<TexturePageDescription["textures"][number]>;
} {
	const pageBits = new Uint8Array(2 * 2 * 4);
	pageBits[0] = firstByte;
	return {
		height: 2,
		pageBits,
		purpose,
		textures: [
			{
				key,
				placement: {
					bounds: new AABB2(new Vec2(0, 0), new Vec2(2, 2)),
					gutter,
				},
			},
		],
		width: 2,
	};
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly arrayUploads: Array<{
		readonly key: TextureArrayResourceKey;
		readonly layer: number;
		readonly firstByte: number;
	}> = [];
	failNextArrayUpload = false;
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
		void upload;
		return `texture-2d-resource:${this.#nextTextureId++}`;
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		return `texture-array-resource:${this.#nextTextureArrayId++}`;
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		if (this.failNextArrayUpload) {
			this.failNextArrayUpload = false;
			throw new Error("Fixture array upload failed.");
		}
		this.arrayUploads.push({
			firstByte: upload.data[0],
			key,
			layer: upload.layer,
		});
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		void key;
	}

	releaseResource(key: RenderResourceKey): boolean {
		void key;
		return true;
	}

	async destroy(): Promise<void> {}
}
