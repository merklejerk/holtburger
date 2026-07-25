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
	createAssetTextureKey,
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
const STANDALONE_KEY = createAssetTextureKey(
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
	kind: "asset",
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
		expect(textures.getAtlasPageResource(PAGE_ID)).toBe(
			"texture-2d-resource:0",
		);
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

	it("does not materialize a texture after its final owner withdraws mid-prepare", async () => {
		const resources = new FakeRendererResourceManager();
		const preparer = new DeferredTexturePreparer();
		const textures = createTextureManager(resources, preparer);

		const retaining = textures.retain("terrain:a", [STANDALONE_FACT]);
		textures.dropOwner("terrain:a");
		preparer.resolve(STANDALONE_FACT);
		await retaining;

		expect(resources.texture2DUploads).toEqual([]);
		expect(textures.hasTexture(STANDALONE_KEY)).toBe(false);
	});

	it("retains every atlas entry through its owning page", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const page = createPage();

		textures.installAtlasPage("objects:a", PAGE_ID, page);
		textures.dropOwner("objects:a");

		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});

	it("atomically replaces an inferior overlapping page when the candidate covers more retained keys", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const keyA = objectKey("0x05000011");
		const keyB = objectKey("0x05000012");

		textures.installAtlasPage("objects:a", "page:a", pageFor([keyA]));
		textures.installAtlasPage("objects:b", "page:b", pageFor([keyA, keyB]));

		expect(textures.getAtlasBinding(keyA).resource).toBe(
			"texture-2d-resource:1",
		);
		expect(textures.getAtlasBinding(keyB).resource).toBe(
			"texture-2d-resource:1",
		);
		expect(textures.getDiagnostics()).toMatchObject({
			activeAtlasPages: 1,
			canonicalAtlasBindings: 2,
			canonicalAtlasReplacements: 1,
			publishedAtlasCandidates: 2,
			releasedAtlasPages: 1,
		});
		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});

	it("reports active page occupancy and canonical arbitration without exposing pixels", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const keyA = objectKey("0x05000021");
		const keyB = objectKey("0x05000022");
		const keyC = objectKey("0x05000023");
		const keyD = objectKey("0x05000024");

		textures.installAtlasPage("objects:a", "page:a", pageFor([keyA, keyB]));
		textures.installAtlasPage(
			"objects:b",
			"page:b",
			pageFor([keyB, keyC, keyD]),
		);

		expect(textures.getAtlasPageDiagnostics()).toEqual([
			{
				byteLength: 32,
				canonicalEntryCount: 1,
				canonicalOccupiedPixelRatio: 0.5,
				candidateEntryCount: 2,
				candidateOccupiedPixelRatio: 1,
				entries: [
					{
						canonical: true,
						height: 2,
						key: keyA,
						width: 2,
						x: 0,
						y: 0,
					},
					{
						canonical: false,
						height: 2,
						key: keyB,
						width: 2,
						x: 2,
						y: 0,
					},
				],
				height: 2,
				pageId: "page:a",
				purpose: TexturePurpose.ObjectDirectColor,
				width: 4,
			},
			{
				byteLength: 48,
				canonicalEntryCount: 3,
				canonicalOccupiedPixelRatio: 1,
				candidateEntryCount: 3,
				candidateOccupiedPixelRatio: 1,
				entries: [
					{
						canonical: true,
						height: 2,
						key: keyB,
						width: 2,
						x: 0,
						y: 0,
					},
					{
						canonical: true,
						height: 2,
						key: keyC,
						width: 2,
						x: 2,
						y: 0,
					},
					{
						canonical: true,
						height: 2,
						key: keyD,
						width: 2,
						x: 4,
						y: 0,
					},
				],
				height: 2,
				pageId: "page:b",
				purpose: TexturePurpose.ObjectDirectColor,
				width: 6,
			},
		]);
	});

	it("keeps the incumbent atlas page on an exact quality tie", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const key = objectKey("0x05000013");

		textures.installAtlasPage("objects:a", "page:a", pageFor([key]));
		textures.installAtlasPage("objects:b", "page:b", pageFor([key]));

		expect(textures.getAtlasBinding(key).resource).toBe(
			"texture-2d-resource:0",
		);
		expect(resources.releasedResources).toEqual(["texture-2d-resource:1"]);
	});

	it("does not prefer a larger page when retained coverage is unchanged", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const key = objectKey("0x05000015");
		const compact = pageFor([key]);
		const oversized = {
			...compact,
			height: 4,
			pageBits: new Uint8Array(4 * 4 * 4),
			width: 4,
		};

		textures.installAtlasPage("objects:a", "page:a", compact);
		textures.installAtlasPage("objects:b", "page:b", oversized);

		expect(textures.getAtlasBinding(key).resource).toBe(
			"texture-2d-resource:0",
		);
		expect(resources.releasedResources).toEqual(["texture-2d-resource:1"]);
	});

	it("retains a shared canonical atlas binding until its final logical owner withdraws", () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(resources);
		const key = objectKey("0x05000014");

		textures.installAtlasPage("objects:a", "page:a", pageFor([key]));
		textures.installAtlasPage("objects:b", "page:b", pageFor([key]));
		textures.dropOwner("objects:a");
		expect(textures.getAtlasBinding(key).resource).toBe(
			"texture-2d-resource:0",
		);
		textures.dropOwner("objects:b");

		expect(resources.releasedResources).toEqual([
			"texture-2d-resource:1",
			"texture-2d-resource:0",
		]);
	});

	it("does not publish a late standalone texture after a packed page wins", async () => {
		const resources = new FakeRendererResourceManager();
		const preparer = new DeferredTexturePreparer();
		const textures = createTextureManager(resources, preparer);
		const key = objectKey("0x05000016");
		const fact: TextureFact = {
			kind: "asset",
			key,
			purpose: TexturePurpose.ObjectDirectColor,
			sourceAssetId: "0x05000016",
		};

		const retaining = textures.retain("objects:standalone", [fact]);
		textures.installAtlasPage("objects:packed", "page:a", pageFor([key]));
		preparer.resolve(fact);
		await retaining;

		expect(textures.getAtlasBinding(key).resource).toBe(
			"texture-2d-resource:0",
		);
		expect(resources.texture2DUploads).toHaveLength(1);
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

	it("keeps independently reserved generated textures after an asset retain fails", async () => {
		const resources = new FakeRendererResourceManager();
		const textures = createTextureManager(
			resources,
			new RejectingTexturePreparer(),
		);
		const key = createTerrainSurfaceTextureKey("0x1111ffff", 1);
		textures.reserveKeys("terrain:a", [key]);
		textures.upsertGeneratedTextures([
			{
				key,
				upload: {
					data: new Uint32Array(64),
					format: IntegerTexture2DFormat.R32UI,
					height: 8,
					mipLevels: 1,
					width: 8,
				},
			},
		]);

		await textures.retain("terrain:a", [STANDALONE_FACT]);

		expect(textures.hasTexture(key)).toBe(true);
		expect(textures.hasTexture(STANDALONE_KEY)).toBe(false);
		expect(resources.releasedResources).toEqual([]);

		textures.dropOwner("terrain:a");
		expect(resources.releasedResources).toEqual(["texture-2d-resource:0"]);
	});
});

function createTextureManager(
	resources: RendererResourceManager,
	preparer: TexturePreparer = new FixtureTexturePreparer(),
): TextureManager<string> {
	return new TextureManager(resources, preparer);
}

function createPage(): TexturePageDescription {
	return pageFor([objectKey("0x05000003")]);
}

function objectKey(sourceAssetId: `0x${string}`) {
	return createAssetTextureKey(TexturePurpose.ObjectDirectColor, sourceAssetId);
}

function pageFor(
	keys: readonly ReturnType<typeof objectKey>[],
): TexturePageDescription {
	const width = keys.length * 2;
	return {
		height: 2,
		pageBits: new Uint8Array(width * 2 * 4),
		purpose: TexturePurpose.ObjectDirectColor,
		textures: keys.map((key, index) => ({
			key,
			placement: {
				bounds: new AABB2(new Vec2(index * 2, 0), new Vec2(index * 2 + 2, 2)),
				preparation: WRAPPED_ATLAS_PREPARATION,
			},
		})),
		width,
	};
}

function createPixels(firstByte = 0): Uint8Array {
	const pixels = new Uint8Array(2 * 2 * 4);
	pixels[0] = firstByte;
	return pixels;
}

class FixtureTexturePreparer implements TexturePreparer {
	prepare(fact: TextureFact) {
		if (fact.kind === "asset") {
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

class DeferredTexturePreparer implements TexturePreparer {
	#resolve:
		| ((source: Awaited<ReturnType<FixtureTexturePreparer["prepare"]>>) => void)
		| null = null;

	prepare() {
		return new Promise<Awaited<ReturnType<FixtureTexturePreparer["prepare"]>>>(
			(resolve) => {
				this.#resolve = resolve;
			},
		);
	}

	resolve(fact: TextureFact): void {
		if (!this.#resolve) throw new Error("Texture preparation is not pending.");
		const resolve = this.#resolve;
		this.#resolve = null;
		void new FixtureTexturePreparer().prepare(fact).then(resolve);
	}

	async destroy(): Promise<void> {}
}

class RejectingTexturePreparer implements TexturePreparer {
	async prepare(fact: TextureFact): Promise<never> {
		void fact;
		throw new Error("Synthetic asset texture preparation failure.");
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
