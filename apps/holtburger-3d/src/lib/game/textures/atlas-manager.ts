import type { AABB2 } from "../math/types";
import type {
	RendererResourceManager,
	RenderResourceKey,
} from "../renderer/resource-manager";
import type { TextureGutterPolicy, TextureKey, TexturePurpose } from "./types";

export type AtlasPageId = `page:${string}`;

export interface TexturePlacement {
	bounds: AABB2;
	gutter: TextureGutterPolicy;
}

interface AtlasPage {
	purpose: TexturePurpose;
	width: number;
	height: number;
	textures: Map<TextureKey, TexturePlacement>;
	resource: RenderResourceKey;
}

export interface AtlasPageDescription {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly textures: Array<{ key: TextureKey; placement: TexturePlacement }>;
}

export class AtlasManager {
	readonly #renderResources: RendererResourceManager;
	readonly #textureToPage: Map<TextureKey, AtlasPageId> = new Map();
	readonly #pages: Map<AtlasPageId, AtlasPage> = new Map();

	constructor(renderResources: RendererResourceManager) {
		this.#renderResources = renderResources;
	}

	upsertPage(id: AtlasPageId, desc: AtlasPageDescription): boolean {
		void id;
		void desc;
		// ... check texture uniqueness.
		// ... return true if new page
	}

	releaseTexture(texture: TextureKey): boolean {
		void texture;
		// ...
	}
}
