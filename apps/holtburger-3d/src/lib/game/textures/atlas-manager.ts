import type { AABB2 } from "../math/types";
import type {
	RendererResourceManager,
	TextureResourceKey,
} from "../renderer/resource-manager";
import type {
	TextureGutterPolicy,
	TextureKey,
	TexturePixelFormat,
	TexturePurpose,
} from "./types";

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
	resource: TextureResourceKey;
}

export interface AtlasPageDescription {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly format: TexturePixelFormat;
	readonly pageBits: Uint8Array;
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
		if (
			new Set(desc.textures.map(({ key }) => key)).size !== desc.textures.length
		) {
			throw new Error(`Atlas page ${id} contains duplicate texture keys.`);
		}
		for (const { key } of desc.textures) {
			const owner = this.#textureToPage.get(key);
			if (owner !== undefined && owner !== id) {
				throw new Error(
					`Texture ${key} already belongs to atlas page ${owner}.`,
				);
			}
		}

		const existing = this.#pages.get(id);
		const upload = {
			data: desc.pageBits,
			format: desc.format,
			height: desc.height,
			width: desc.width,
		};
		const resource = existing
			? existing.resource
			: this.#renderResources.createTexture(upload);
		if (existing) this.#renderResources.replaceTexture(resource, upload);

		for (const key of existing?.textures.keys() ?? []) {
			this.#textureToPage.delete(key);
		}
		const textures = new Map(
			desc.textures.map(({ key, placement }) => [key, placement]),
		);
		for (const key of textures.keys()) this.#textureToPage.set(key, id);
		this.#pages.set(id, {
			height: desc.height,
			purpose: desc.purpose,
			resource,
			textures,
			width: desc.width,
		});
		return existing === undefined;
	}

	releaseTexture(texture: TextureKey): boolean {
		const pageId = this.#textureToPage.get(texture);
		if (pageId === undefined) return false;
		const page = this.#pages.get(pageId);
		if (!page) {
			throw new Error(
				`Texture ${texture} references missing atlas page ${pageId}.`,
			);
		}
		this.#textureToPage.delete(texture);
		page.textures.delete(texture);
		if (page.textures.size === 0) {
			this.#pages.delete(pageId);
			this.#renderResources.releaseResource(page.resource);
		}
		return true;
	}
}
