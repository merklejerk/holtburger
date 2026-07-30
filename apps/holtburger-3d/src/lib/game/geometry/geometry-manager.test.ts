import { describe, expect, it } from "vitest";
import type { RenderGeometryData } from "../renderer/geometry";
import type {
	GeometryResourceKey,
	InstanceStreamResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../renderer/resource-manager";
import type { StaticInstanceStreamData } from "../systems/static-resources";
import { GeometryManager } from "./geometry-manager";
import { createTerrainGeometryKey } from "./types";

describe("GeometryManager", () => {
	it("materializes one shared geometry resource and releases it after its final owner", () => {
		const resources = new FakeRendererResourceManager();
		const geometry = new GeometryManager<string>(resources);
		const key = createTerrainGeometryKey("0x1111ffff");
		const source = { geometry: createTerrainGeometry(), key };

		geometry.reserveKeys("terrain:a", [key]);
		geometry.reserveKeys("terrain:b", [key]);
		geometry.upsertGeometry(source);
		geometry.upsertGeometry(source);

		expect(geometry.getResource(key)).toBe("geometry-resource:0");
		expect(resources.created).toEqual(["geometry-resource:0"]);

		geometry.dropOwner("terrain:a");
		expect(resources.released).toEqual([]);
		geometry.dropOwner("terrain:b");
		expect(resources.released).toEqual(["geometry-resource:0"]);
	});
});

function createTerrainGeometry(): RenderGeometryData {
	return {
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain",
		normals: new Float32Array(9),
		positions: new Float32Array(9),
		textureCoordinates: new Float32Array(6),
	};
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly created: GeometryResourceKey[] = [];
	readonly released: RenderResourceKey[] = [];
	#nextGeometry = 0;

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		const key: GeometryResourceKey = `geometry-resource:${this.#nextGeometry++}`;
		this.created.push(key);
		return key;
	}

	createStaticInstanceStream(
		data: StaticInstanceStreamData,
	): InstanceStreamResourceKey {
		void data;
		throw new Error("Geometry manager tests do not create instance streams.");
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		void upload;
		throw new Error("Geometry manager tests do not create textures.");
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		throw new Error("Geometry manager tests do not create textures.");
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		void key;
		void upload;
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		void key;
	}

	releaseResource(key: RenderResourceKey): boolean {
		this.released.push(key);
		return true;
	}

	async destroy(): Promise<void> {}
}
