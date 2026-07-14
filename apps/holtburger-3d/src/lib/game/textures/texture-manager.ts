import type { AABB2 } from "../math/types";
import type {
	RendererResourceManager,
	TextureArrayDescription,
	TextureArrayResourceKey,
	Texture2DResourceKey,
} from "../renderer/resource-manager";
import {
	TextureGutterPolicy,
	type TextureKey,
	type TexturePurpose,
	texturePixelFormatForPurpose,
} from "./types";

/** Stable identity for one prepared page of texture pixels. */
export type TexturePageId = `page:${string}`;

/** Stable identity for one homogeneous texture-array allocation. */
export type TextureArrayId = `texture-array:${string}`;

/** Pixel-space location of one logical texture within a prepared page. */
export interface TexturePlacement {
	readonly bounds: AABB2;
	readonly gutter: TextureGutterPolicy;
}

/** Prepared page consumed as a packed atlas or one complete array layer. */
export interface TexturePageDescription {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly pageBits: Uint8Array;
	readonly textures: readonly {
		readonly key: TextureKey;
		readonly placement: TexturePlacement;
	}[];
}

/** Immutable allocation policy for one purpose-specific texture array. */
export interface ManagedTextureArrayDescription extends Omit<
	TextureArrayDescription,
	"format"
> {
	readonly purpose: TexturePurpose;
}

/** Backend array resource and layer assigned to one logical texture. */
export interface TextureArrayBinding {
	readonly resource: TextureArrayResourceKey;
	readonly layer: number;
}

/** Backend atlas resource and page-relative placement for one logical texture. */
export interface TextureAtlasBinding {
	readonly resource: Texture2DResourceKey;
	readonly placement: TexturePlacement;
}

interface PackedTexturePage {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly textures: Map<TextureKey, TexturePlacement>;
	readonly resource: Texture2DResourceKey;
}

interface ManagedTextureArray {
	readonly description: ManagedTextureArrayDescription;
	readonly freeLayers: number[];
	readonly resource: TextureArrayResourceKey;
	readonly textures: Map<
		TextureKey,
		{ readonly layer: number; readonly pageId: TexturePageId }
	>;
}

type TextureOwner =
	| { readonly kind: "atlas"; readonly pageId: TexturePageId }
	| { readonly kind: "array"; readonly arrayId: TextureArrayId };

/** Owns committed source textures across packed atlases and texture arrays. */
export class TextureManager {
	readonly #renderResources: RendererResourceManager;
	readonly #textureOwners = new Map<TextureKey, TextureOwner>();
	readonly #atlasPages = new Map<TexturePageId, PackedTexturePage>();
	readonly #textureArrays = new Map<TextureArrayId, ManagedTextureArray>();
	readonly #arrayPageOwners = new Map<
		TexturePageId,
		{ readonly arrayId: TextureArrayId; readonly textureKey: TextureKey }
	>();

	constructor(renderResources: RendererResourceManager) {
		this.#renderResources = renderResources;
	}

	upsertAtlasPage(
		id: TexturePageId,
		description: TexturePageDescription,
	): boolean {
		validatePage(description, id);
		for (const { key } of description.textures) {
			this.#assertTextureOwner(key, { kind: "atlas", pageId: id });
		}

		const existing = this.#atlasPages.get(id);
		const upload = {
			data: description.pageBits,
			format: texturePixelFormatForPurpose(description.purpose),
			height: description.height,
			width: description.width,
		};
		const resource = existing
			? existing.resource
			: this.#renderResources.createTexture2D(upload);
		if (existing) this.#renderResources.replaceTexture2D(resource, upload);

		for (const key of existing?.textures.keys() ?? []) {
			this.#textureOwners.delete(key);
		}
		const textures = new Map(
			description.textures.map(({ key, placement }) => [key, placement]),
		);
		for (const key of textures.keys()) {
			this.#textureOwners.set(key, { kind: "atlas", pageId: id });
		}
		this.#atlasPages.set(id, {
			height: description.height,
			purpose: description.purpose,
			resource,
			textures,
			width: description.width,
		});
		return existing === undefined;
	}

	createTextureArray(
		id: TextureArrayId,
		description: ManagedTextureArrayDescription,
	): boolean {
		const existing = this.#textureArrays.get(id);
		if (existing) {
			if (!sameArrayDescription(existing.description, description)) {
				throw new Error(`Texture array ${id} already has a different shape.`);
			}
			return false;
		}

		const resource = this.#renderResources.createTextureArray({
			...description,
			format: texturePixelFormatForPurpose(description.purpose),
		});
		this.#textureArrays.set(id, {
			description,
			freeLayers: createLayerStack(description.layerCapacity),
			resource,
			textures: new Map(),
		});
		return true;
	}

	upsertTextureArrayPage(
		arrayId: TextureArrayId,
		pageId: TexturePageId,
		description: TexturePageDescription,
	): TextureArrayBinding {
		validatePage(description, pageId);
		if (description.textures.length !== 1) {
			throw new Error(
				`Texture array page ${pageId} must contain exactly one texture.`,
			);
		}
		const [{ key, placement }] = description.textures;
		if (placement.gutter !== TextureGutterPolicy.None) {
			throw new Error(`Texture array page ${pageId} cannot contain a gutter.`);
		}
		if (!placementCoversPage(placement, description)) {
			throw new Error(
				`Texture array page ${pageId} placement must cover the complete page.`,
			);
		}

		const array = this.#requireTextureArray(arrayId);
		validateArrayPage(arrayId, array.description, pageId, description);
		this.#assertTextureOwner(key, { kind: "array", arrayId });

		const previousPage = this.#arrayPageOwners.get(pageId);
		if (previousPage && previousPage.arrayId !== arrayId) {
			throw new Error(
				`Texture page ${pageId} already belongs to array ${previousPage.arrayId}.`,
			);
		}
		const existingTexture = array.textures.get(key);
		if (existingTexture && existingTexture.pageId !== pageId) {
			throw new Error(
				`Texture ${key} already belongs to array page ${existingTexture.pageId}.`,
			);
		}
		if (previousPage && previousPage.textureKey !== key && !existingTexture) {
			throw new Error(
				`Texture array page ${pageId} cannot replace ${previousPage.textureKey} with ${key}.`,
			);
		}

		const allocatedLayer = existingTexture === undefined;
		const layer = existingTexture?.layer ?? array.freeLayers.pop();
		if (layer === undefined) {
			throw new Error(`Texture array ${arrayId} has no free layers.`);
		}
		try {
			this.#renderResources.uploadTextureArrayLayer(array.resource, {
				data: description.pageBits,
				layer,
			});
		} catch (error) {
			if (allocatedLayer) array.freeLayers.push(layer);
			throw error;
		}
		array.textures.set(key, { layer, pageId });
		this.#arrayPageOwners.set(pageId, { arrayId, textureKey: key });
		this.#textureOwners.set(key, { arrayId, kind: "array" });
		return { layer, resource: array.resource };
	}

	generateTextureArrayMipmaps(id: TextureArrayId): void {
		this.#renderResources.generateTextureArrayMipmaps(
			this.#requireTextureArray(id).resource,
		);
	}

	getAtlasBinding(texture: TextureKey): TextureAtlasBinding {
		const owner = this.#textureOwners.get(texture);
		if (!owner || owner.kind !== "atlas") {
			throw new Error(`Texture ${texture} does not have an atlas binding.`);
		}
		const page = this.#atlasPages.get(owner.pageId);
		const placement = page?.textures.get(texture);
		if (!page || !placement) {
			throw new Error(`Texture ${texture} has an invalid atlas binding.`);
		}
		return { placement, resource: page.resource };
	}

	getTextureArrayBinding(texture: TextureKey): TextureArrayBinding {
		const owner = this.#textureOwners.get(texture);
		if (!owner || owner.kind !== "array") {
			throw new Error(`Texture ${texture} does not have an array binding.`);
		}
		const array = this.#textureArrays.get(owner.arrayId);
		const entry = array?.textures.get(texture);
		if (!array || !entry) {
			throw new Error(`Texture ${texture} has an invalid array binding.`);
		}
		return { layer: entry.layer, resource: array.resource };
	}

	releaseTexture(texture: TextureKey): boolean {
		const owner = this.#textureOwners.get(texture);
		if (!owner) return false;
		this.#textureOwners.delete(texture);
		if (owner.kind === "atlas") {
			return this.#releaseAtlasTexture(owner.pageId, texture);
		}

		const array = this.#requireTextureArray(owner.arrayId);
		const entry = array.textures.get(texture);
		if (!entry) {
			throw new Error(
				`Texture ${texture} is missing from array ${owner.arrayId}.`,
			);
		}
		array.textures.delete(texture);
		this.#arrayPageOwners.delete(entry.pageId);
		array.freeLayers.push(entry.layer);
		return true;
	}

	removeTextureArray(id: TextureArrayId): boolean {
		const array = this.#textureArrays.get(id);
		if (!array) return false;
		if (array.textures.size !== 0) {
			throw new Error(`Texture array ${id} still owns textures.`);
		}
		this.#textureArrays.delete(id);
		if (!this.#renderResources.releaseResource(array.resource)) {
			throw new Error(`Texture array ${id} lost its backend resource.`);
		}
		return true;
	}

	#releaseAtlasTexture(pageId: TexturePageId, texture: TextureKey): boolean {
		const page = this.#atlasPages.get(pageId);
		if (!page) {
			throw new Error(`Texture ${texture} references missing page ${pageId}.`);
		}
		page.textures.delete(texture);
		if (page.textures.size === 0) {
			this.#atlasPages.delete(pageId);
			if (!this.#renderResources.releaseResource(page.resource)) {
				throw new Error(`Texture page ${pageId} lost its backend resource.`);
			}
		}
		return true;
	}

	#assertTextureOwner(texture: TextureKey, expected: TextureOwner): void {
		const owner = this.#textureOwners.get(texture);
		if (!owner || sameTextureOwner(owner, expected)) return;
		throw new Error(
			`Texture ${texture} already has a different storage owner.`,
		);
	}

	#requireTextureArray(id: TextureArrayId): ManagedTextureArray {
		const array = this.#textureArrays.get(id);
		if (!array) throw new Error(`Texture array ${id} does not exist.`);
		return array;
	}
}

function validatePage(
	description: TexturePageDescription,
	id: TexturePageId,
): void {
	if (description.width <= 0 || description.height <= 0) {
		throw new Error(`Texture page ${id} dimensions must be positive.`);
	}
	if (
		new Set(description.textures.map(({ key }) => key)).size !==
		description.textures.length
	) {
		throw new Error(`Texture page ${id} contains duplicate texture keys.`);
	}
}

function validateArrayPage(
	arrayId: TextureArrayId,
	array: ManagedTextureArrayDescription,
	pageId: TexturePageId,
	page: TexturePageDescription,
): void {
	if (
		array.purpose !== page.purpose ||
		array.width !== page.width ||
		array.height !== page.height
	) {
		throw new Error(
			`Texture page ${pageId} is incompatible with array ${arrayId}.`,
		);
	}
}

function createLayerStack(capacity: number): number[] {
	return Array.from({ length: capacity }, (_, layer) => capacity - layer - 1);
}

function placementCoversPage(
	placement: TexturePlacement,
	page: TexturePageDescription,
): boolean {
	return (
		placement.bounds.min.x === 0 &&
		placement.bounds.min.y === 0 &&
		placement.bounds.max.x === page.width &&
		placement.bounds.max.y === page.height
	);
}

function sameArrayDescription(
	left: ManagedTextureArrayDescription,
	right: ManagedTextureArrayDescription,
): boolean {
	return (
		left.purpose === right.purpose &&
		left.width === right.width &&
		left.height === right.height &&
		left.mipLevels === right.mipLevels &&
		left.layerCapacity === right.layerCapacity &&
		left.sampling === right.sampling
	);
}

function sameTextureOwner(left: TextureOwner, right: TextureOwner): boolean {
	return left.kind === "atlas"
		? right.kind === "atlas" && left.pageId === right.pageId
		: right.kind === "array" && left.arrayId === right.arrayId;
}
