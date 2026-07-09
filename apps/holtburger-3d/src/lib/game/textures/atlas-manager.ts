import type { AABB2 } from "../math/types";
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
}

export interface AtlasPageDescription {
	purpose: TexturePurpose;
	width: number;
	height: number;
	textures: Set<{ key: TextureKey; placement: TexturePlacement }>;
}

export class AtlasManager {
	readonly #textureToPage: Map<TextureKey, AtlasPageId> = new Map();
	readonly #pages: Map<AtlasPageId, AtlasPage> = new Map();

	upsertPage(id: AtlasPageId, desc: AtlasPageDescription): boolean {
		void id;
		void desc;
		// ... return true if new page
	}

	releaseTexture(texture: TextureKey): boolean {
		void texture;
		// ...
	}
}
