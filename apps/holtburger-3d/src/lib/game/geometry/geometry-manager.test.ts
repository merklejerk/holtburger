import { describe, expect, it } from "vitest";
import type { RenderGeometryData } from "../renderer/geometry";
import type {
	GeometryResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../renderer/resource-manager";
import { GeometryManager } from "./geometry-manager";
import { createObjectGeometryKey, createTerrainGeometryKey } from "./types";

describe("GeometryManager", () => {
	it("shares merged layout storage across appearances and counts both selector streams", () => {
		const resources = new FakeRendererResourceManager();
		const geometry = new GeometryManager<string>(resources);
		const payload = {
			kind: "dynamic-parts" as const,
			partCount: 1,
			materialCount: 1,
			positions: new Float32Array(9),
			normals: new Float32Array(9),
			textureCoordinates: new Float32Array(6),
			indices: new Uint32Array([0, 1, 2]),
			partSelectors: new Uint32Array(3),
			materialSelectors: new Uint32Array(3),
		};
		const source = {
			key: createObjectGeometryKey("dynamic-layout:test"),
			geometry: payload,
		};
		geometry.replaceOwner("appearance:a", [source]);
		geometry.replaceOwner("appearance:b", [source]);
		expect(resources.created).toHaveLength(1);
		const bytes =
			payload.positions.byteLength +
			payload.normals.byteLength +
			payload.textureCoordinates.byteLength +
			payload.partSelectors.byteLength +
			payload.materialSelectors.byteLength;
		expect(geometry.getResourceBytes()).toBe(bytes);
		geometry.dropOwner("appearance:a");
		expect(geometry.getResourceBytes()).toBe(bytes);
		expect(resources.released).toHaveLength(0);
		geometry.dropOwner("appearance:b");
		expect(geometry.getResourceBytes()).toBe(0);
		expect(resources.released).toHaveLength(1);
	});
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

	it("rolls back replacement leases and resources before preserving the previous owner set", () => {
		const resources = new FakeRendererResourceManager();
		const geometry = new GeometryManager<string>(resources);
		const previousKey = createTerrainGeometryKey("0x1111ffff");
		geometry.reserveKeys("terrain", [previousKey]);
		geometry.upsertGeometry({
			geometry: createTerrainGeometry(),
			key: previousKey,
		});
		resources.failOnCreateNumber = 2;

		expect(() =>
			geometry.replaceOwner("terrain", [
				{
					geometry: createTerrainGeometry(),
					key: createTerrainGeometryKey("0x2222ffff"),
				},
				{
					geometry: createTerrainGeometry(),
					key: createTerrainGeometryKey("0x3333ffff"),
				},
			]),
		).toThrow("geometry creation failed");
		expect(geometry.getResource(previousKey)).toBe("geometry-resource:0");
		expect(resources.released).toEqual(["geometry-resource:1"]);
	});
});

function createTerrainGeometry(): RenderGeometryData {
	return {
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain",
		normals: new Float32Array(9),
		positions: new Float32Array(9),
		terrainColorCodes: new Uint8Array(3),
		textureCoordinates: new Float32Array(6),
	};
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly created: GeometryResourceKey[] = [];
	readonly released: RenderResourceKey[] = [];
	failOnCreateNumber: number | null = null;
	#nextGeometry = 0;

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		if (this.#nextGeometry === this.failOnCreateNumber)
			throw new Error("geometry creation failed");
		const key: GeometryResourceKey = `geometry-resource:${this.#nextGeometry++}`;
		this.created.push(key);
		return key;
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

	updateTexture2DRegions(): void {
		throw new Error("Texture region updates are outside this fixture.");
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
