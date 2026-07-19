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
import type { GeometryKey } from "./types";

/** Create one resident geometry manager for renderer-side logical-resource tests. */
export function createPublishedGeometryManager(
	key: GeometryKey,
): GeometryManager<string> {
	const manager = new GeometryManager<string>(
		new FixtureRendererResourceManager(),
	);
	manager.reserveKeys("fixture", [key]);
	manager.upsertGeometry({ geometry: FIXTURE_GEOMETRY, key });
	return manager;
}

const FIXTURE_GEOMETRY: RenderGeometryData = {
	indices: new Uint16Array([0, 1, 2]),
	kind: "object",
	materialSlots: new Uint16Array(3),
	normals: new Float32Array(9),
	positions: new Float32Array(9),
	textureCoordinates: new Float32Array(6),
};

class FixtureRendererResourceManager implements RendererResourceManager {
	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		return "geometry-resource:0";
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
		throw new Error("Fixture renderer does not replace geometry.");
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		void upload;
		throw new Error("Fixture renderer does not create textures.");
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
		throw new Error("Fixture renderer does not replace textures.");
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		throw new Error("Fixture renderer does not create texture arrays.");
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		void key;
		void upload;
		throw new Error("Fixture renderer does not upload texture arrays.");
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		void key;
		throw new Error(
			"Fixture renderer does not generate texture-array mipmaps.",
		);
	}

	releaseResource(key: RenderResourceKey): boolean {
		void key;
		return true;
	}

	async destroy(): Promise<void> {}
}
