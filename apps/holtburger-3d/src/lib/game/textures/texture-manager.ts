import type { AABB2 } from "../math/types";
import { LeaseRegistry } from "../ownership";
import type {
	RendererResourceManager,
	TextureArrayDescription,
	TextureArrayResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
} from "../renderer/resource-manager";
import type { DatAssetId } from "../game-types";
import type { TexturePreparer } from "./texture-preparer";
import {
	type GeneratedTextureKey,
	type StandaloneTextureFact,
	type StandaloneTextureKey,
	type TextureArrayFact,
	type TextureAtlasEntryKey,
	type TextureArrayKey,
	type TextureKey,
	type TextureFact,
	type TexturePreparation,
	type TexturePurpose,
	isTextureArrayKey,
	isGeneratedTextureKey,
	isStandaloneTextureKey,
	standaloneTextureKeyMatchesSource,
	textureArrayKeyMatchesPurpose,
	texturePurposePolicy,
} from "./types";

/** Stable identity for one prepared page of texture pixels. */
export type TexturePageId = `page:${string}`;

/** Pixel-space location of one logical texture within a prepared page. */
export interface TexturePlacement {
	readonly bounds: AABB2;
	/** Preparation represented by this page entry and its texture key. */
	readonly preparation: TexturePreparation;
}

/** Prepared page consumed as one packed two-dimensional atlas. */
export interface TexturePageDescription {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly pageBits: Uint8Array;
	readonly textures: readonly {
		readonly key: TextureAtlasEntryKey;
		readonly placement: TexturePlacement;
	}[];
}

/** One decoded DAT texture occupying a deterministic array layer. */
export interface TextureArrayLayerSource {
	/** DAT source identity used to resolve shader composition references. */
	readonly sourceAssetId: DatAssetId;
	/** Complete level-zero pixels for this layer. */
	readonly pixels: Uint8Array;
}

/** Complete immutable source used to create one texture array atomically. */
export interface TextureArraySource {
	readonly key: TextureArrayKey;
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	/** Ordered layers whose indices remain stable for the array lifetime. */
	readonly layers: readonly TextureArrayLayerSource[];
}

/** Complete immutable source used to create one unpacked texture atomically. */
export interface StandaloneTextureSource {
	/** Logical identity derived from source and purpose. */
	readonly key: StandaloneTextureKey;
	/** DAT texture represented by this complete resource. */
	readonly sourceAssetId: DatAssetId;
	/** Semantic use that fixes device format and mip policy. */
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	/** Complete level-zero pixels for this texture. */
	readonly pixels: Uint8Array;
}

/** Backend array resource plus deterministic DAT-source layer assignments. */
export interface TextureArrayBinding {
	readonly resource: TextureArrayResourceKey;
	readonly layersByAssetId: ReadonlyMap<DatAssetId, number>;
}

/** Backend resource backing one complete two-dimensional logical texture. */
export interface Texture2DBinding {
	readonly resource: Texture2DResourceKey;
}

/** Backend atlas resource and page-relative placement for one logical texture. */
export interface TextureAtlasBinding {
	readonly resource: Texture2DResourceKey;
	readonly placement: TexturePlacement;
}

/** Complete generated texture payload published directly by a CPU producer. */
export interface GeneratedTextureSource {
	readonly key: GeneratedTextureKey;
	readonly upload: Texture2DUpload;
}

/** Narrow texture-publishing contract consumed by generated-data systems. */
export interface GeneratedTextureStore {
	/** Upsert complete generated texture payloads by their deterministic logical keys. */
	upsertGeneratedTextures(sources: readonly GeneratedTextureSource[]): void;
}

interface PackedTexturePage {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly textures: Map<TextureAtlasEntryKey, TexturePlacement>;
	readonly resource: Texture2DResourceKey;
}

interface ManagedTextureArray {
	readonly identity: TextureArrayIdentity;
	readonly binding: TextureArrayBinding;
}

interface ManagedStandaloneTexture {
	readonly identity: StandaloneTextureIdentity;
	readonly binding: Texture2DBinding;
}

interface ManagedGeneratedTexture {
	readonly identity: GeneratedTextureIdentity;
	readonly binding: Texture2DBinding;
}

/** Immutable standalone facts retained without pinning uploaded CPU pixels. */
interface StandaloneTextureIdentity {
	readonly sourceAssetId: DatAssetId;
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
}

/** Immutable array facts retained without pinning uploaded CPU pixel payloads. */
interface TextureArrayIdentity {
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly sourceAssetIds: readonly DatAssetId[];
}

/** Immutable generated storage shape retained without pinning CPU pixel payloads. */
interface GeneratedTextureIdentity {
	readonly format: Texture2DUpload["format"];
	readonly width: number;
	readonly height: number;
	readonly mipLevels: number;
}

/** Owns preparation, device resources, and shared owner retention for logical textures. */
export class TextureManager<
	TOwnerId extends string = string,
> implements GeneratedTextureStore {
	readonly #renderResources: RendererResourceManager;
	readonly #preparer: TexturePreparer;
	readonly #leases = new LeaseRegistry<TOwnerId, TextureKey>();
	readonly #atlasOwners = new Map<TextureAtlasEntryKey, TexturePageId>();
	readonly #atlasPages = new Map<TexturePageId, PackedTexturePage>();
	readonly #standaloneTextures = new Map<
		StandaloneTextureKey,
		ManagedStandaloneTexture
	>();
	readonly #generatedTextures = new Map<
		GeneratedTextureKey,
		ManagedGeneratedTexture
	>();
	readonly #textureArrays = new Map<TextureArrayKey, ManagedTextureArray>();

	constructor(
		renderResources: RendererResourceManager,
		preparer: TexturePreparer,
	) {
		this.#renderResources = renderResources;
		this.#preparer = preparer;
	}

	/** Install one already-packed atlas page and retain every entry for its owner. */
	installAtlasPage(
		owner: TOwnerId,
		id: TexturePageId,
		description: TexturePageDescription,
	): void {
		this.upsertAtlasPage(id, description);
		this.retainKeys(
			owner,
			description.textures.map(({ key }) => key),
		);
	}

	/**
	 * Retain texture facts for one owner and materialize missing device resources.
	 * Preparation failures are terminal for that owner's texture set.
	 */
	async retain(owner: TOwnerId, facts: readonly TextureFact[]): Promise<void> {
		this.retainKeys(
			owner,
			facts.map(({ key }) => key),
		);
		try {
			await Promise.all(facts.map((fact) => this.#materialize(fact)));
		} catch (error) {
			this.dropOwner(owner);
			console.error(error);
		}
	}

	/** Retain logical keys whose texture payload may be published later by another producer. */
	retainKeys(owner: TOwnerId, keys: readonly TextureKey[]): void {
		for (const key of keys) this.#leases.addLease(owner, key);
	}

	/**
	 * Materialize complete generated textures only while at least one owner retains their keys.
	 * Repeated publications for an idempotent key must preserve its storage shape.
	 */
	upsertGeneratedTextures(sources: readonly GeneratedTextureSource[]): void {
		const created: Array<{
			readonly key: GeneratedTextureKey;
			readonly resource: Texture2DResourceKey;
			readonly identity: GeneratedTextureIdentity;
		}> = [];
		const pendingKeys = new Set<GeneratedTextureKey>();
		try {
			for (const source of sources) {
				if (!this.#leases.hasLease(source.key)) continue;
				if (pendingKeys.has(source.key)) {
					throw new Error(
						`Generated texture publication contains duplicate key ${source.key}.`,
					);
				}
				const identity = generatedTextureIdentity(source.upload);
				const existing = this.#generatedTextures.get(source.key);
				if (existing) {
					if (!sameGeneratedTextureIdentity(existing.identity, identity)) {
						throw new Error(
							`Generated texture ${source.key} already has a different storage shape.`,
						);
					}
					continue;
				}
				pendingKeys.add(source.key);
				created.push({
					identity,
					key: source.key,
					resource: this.#renderResources.createTexture2D(source.upload),
				});
			}
			for (const texture of created) {
				this.#generatedTextures.set(texture.key, {
					binding: { resource: texture.resource },
					identity: texture.identity,
				});
			}
		} catch (error) {
			for (const { resource } of created.reverse()) {
				if (!this.#renderResources.releaseResource(resource)) {
					throw new Error(
						"Generated texture publication lost a partial backend resource.",
						{ cause: error },
					);
				}
			}
			throw error;
		}
	}

	/** Drop one owner's texture retention and release resources with no remaining owner. */
	dropOwner(owner: TOwnerId): void {
		this.#leases.dropOwner(owner);
		for (const key of this.#leases.takeEmptyLeases()) this.releaseTexture(key);
	}

	/** Stop preparation work and release every texture retained by runtime owners. */
	async destroy(): Promise<void> {
		await this.#preparer.destroy();
		for (const owner of [...this.#leases.iterOwners()]) this.dropOwner(owner);
	}

	upsertAtlasPage(
		id: TexturePageId,
		description: TexturePageDescription,
	): boolean {
		validatePage(description, id);
		for (const { key } of description.textures) {
			const owner = this.#atlasOwners.get(key);
			if (owner !== undefined && owner !== id) {
				throw new Error(
					`Texture ${key} already belongs to atlas page ${owner}.`,
				);
			}
		}

		const existing = this.#atlasPages.get(id);
		const upload = {
			data: description.pageBits,
			format: texturePurposePolicy(description.purpose).format,
			height: description.height,
			mipLevels: mipLevelCount(
				description.purpose,
				description.width,
				description.height,
			),
			width: description.width,
		};
		const resource = existing
			? existing.resource
			: this.#renderResources.createTexture2D(upload);
		if (existing) this.#renderResources.replaceTexture2D(resource, upload);

		for (const key of existing?.textures.keys() ?? []) {
			this.#atlasOwners.delete(key);
		}
		const textures = new Map(
			description.textures.map(({ key, placement }) => [key, placement]),
		);
		for (const key of textures.keys()) this.#atlasOwners.set(key, id);
		this.#atlasPages.set(id, {
			height: description.height,
			purpose: description.purpose,
			resource,
			textures,
			width: description.width,
		});
		return existing === undefined;
	}

	createStandaloneTexture(source: StandaloneTextureSource): boolean {
		validateStandaloneTextureSource(source);
		const existing = this.#standaloneTextures.get(source.key);
		if (existing) {
			if (!sameStandaloneTextureSource(existing.identity, source)) {
				throw new Error(
					`Standalone texture ${source.key} already has a different source.`,
				);
			}
			return false;
		}

		const resource = this.#renderResources.createTexture2D(
			createTexture2DUpload(source),
		);
		this.#standaloneTextures.set(source.key, {
			binding: { resource },
			identity: {
				height: source.height,
				purpose: source.purpose,
				sourceAssetId: source.sourceAssetId,
				width: source.width,
			},
		});
		return true;
	}

	createTextureArray(source: TextureArraySource): boolean {
		validateTextureArraySource(source);
		const existing = this.#textureArrays.get(source.key);
		if (existing) {
			if (!sameTextureArraySource(existing.identity, source)) {
				throw new Error(
					`Texture array ${source.key} already has a different source.`,
				);
			}
			return false;
		}

		const resource = this.#renderResources.createTextureArray(
			createTextureArrayResourceDescription(source),
		);
		try {
			for (const [layer, entry] of source.layers.entries()) {
				this.#renderResources.uploadTextureArrayLayer(resource, {
					data: entry.pixels,
					layer,
				});
			}
			this.#renderResources.generateTextureArrayMipmaps(resource);
		} catch (cause) {
			if (!this.#renderResources.releaseResource(resource)) {
				throw new Error(
					`Texture array ${source.key} failed and lost its partial backend resource.`,
					{ cause },
				);
			}
			throw cause;
		}

		this.#textureArrays.set(source.key, {
			binding: {
				layersByAssetId: new Map(
					source.layers.map(({ sourceAssetId }, layer) => [
						sourceAssetId,
						layer,
					]),
				),
				resource,
			},
			identity: {
				height: source.height,
				purpose: source.purpose,
				sourceAssetIds: source.layers.map(({ sourceAssetId }) => sourceAssetId),
				width: source.width,
			},
		});
		return true;
	}

	getAtlasBinding(texture: TextureAtlasEntryKey): TextureAtlasBinding {
		const pageId = this.#atlasOwners.get(texture);
		if (pageId === undefined) {
			throw new Error(`Texture ${texture} does not have an atlas binding.`);
		}
		const page = this.#atlasPages.get(pageId);
		const placement = page?.textures.get(texture);
		if (!page || !placement) {
			throw new Error(`Texture ${texture} has an invalid atlas binding.`);
		}
		return { placement, resource: page.resource };
	}

	getStandaloneTextureBinding(key: StandaloneTextureKey): Texture2DBinding {
		const texture = this.#standaloneTextures.get(key);
		if (!texture) throw new Error(`Standalone texture ${key} does not exist.`);
		return texture.binding;
	}

	getTextureArrayBinding(key: TextureArrayKey): TextureArrayBinding {
		const array = this.#textureArrays.get(key);
		if (!array) throw new Error(`Texture array ${key} does not exist.`);
		return array.binding;
	}

	getGeneratedTextureBinding(key: GeneratedTextureKey): Texture2DBinding {
		const texture = this.#generatedTextures.get(key);
		if (!texture) throw new Error(`Generated texture ${key} does not exist.`);
		return texture.binding;
	}

	/** Check whether a complete logical texture is currently device-backed. */
	hasTexture(key: TextureKey): boolean {
		if (isTextureArrayKey(key)) return this.#textureArrays.has(key);
		if (isStandaloneTextureKey(key)) return this.#standaloneTextures.has(key);
		if (isGeneratedTextureKey(key)) return this.#generatedTextures.has(key);
		return this.#atlasOwners.has(key);
	}

	releaseTexture(key: TextureKey): boolean {
		if (isTextureArrayKey(key)) return this.#releaseTextureArray(key);
		if (isStandaloneTextureKey(key)) {
			return this.#releaseStandaloneTexture(key);
		}
		if (isGeneratedTextureKey(key)) return this.#releaseGeneratedTexture(key);
		return this.#releaseAtlasTexture(key);
	}

	async #materialize(fact: TextureFact): Promise<void> {
		if (this.hasTexture(fact.key)) return;
		const source = await this.#preparer.prepare(fact);
		if (!this.#leases.hasLease(fact.key)) return;
		if (fact.kind === "array") {
			this.#validatePreparedArraySource(fact, source);
			this.createTextureArray(source);
		} else {
			this.#validatePreparedStandaloneSource(fact, source);
			this.createStandaloneTexture(source);
		}
	}

	#validatePreparedArraySource(
		fact: TextureArrayFact,
		source: TextureArraySource | StandaloneTextureSource,
	): asserts source is TextureArraySource {
		if (source.key !== fact.key || source.purpose !== fact.purpose) {
			throw new Error(
				`Texture preparer returned incompatible source for ${fact.key}.`,
			);
		}
		if (!("layers" in source)) {
			throw new Error(
				`Texture preparer returned standalone data for ${fact.key}.`,
			);
		}
		if (
			source.layers.length !== fact.sourceAssetIds.length ||
			source.layers.some(
				(layer, index) => layer.sourceAssetId !== fact.sourceAssetIds[index],
			)
		) {
			throw new Error(
				`Texture preparer returned incompatible array membership for ${fact.key}.`,
			);
		}
	}

	#validatePreparedStandaloneSource(
		fact: StandaloneTextureFact,
		source: TextureArraySource | StandaloneTextureSource,
	): asserts source is StandaloneTextureSource {
		if (source.key !== fact.key || source.purpose !== fact.purpose) {
			throw new Error(
				`Texture preparer returned incompatible source for ${fact.key}.`,
			);
		}
		if ("layers" in source) {
			throw new Error(`Texture preparer returned array data for ${fact.key}.`);
		}
		if (source.sourceAssetId !== fact.sourceAssetId) {
			throw new Error(
				`Texture preparer returned incompatible source asset for ${fact.key}.`,
			);
		}
	}

	#releaseStandaloneTexture(key: StandaloneTextureKey): boolean {
		const texture = this.#standaloneTextures.get(key);
		if (!texture) return false;
		this.#standaloneTextures.delete(key);
		if (!this.#renderResources.releaseResource(texture.binding.resource)) {
			throw new Error(`Standalone texture ${key} lost its backend resource.`);
		}
		return true;
	}

	#releaseTextureArray(key: TextureArrayKey): boolean {
		const array = this.#textureArrays.get(key);
		if (!array) return false;
		this.#textureArrays.delete(key);
		if (!this.#renderResources.releaseResource(array.binding.resource)) {
			throw new Error(`Texture array ${key} lost its backend resource.`);
		}
		return true;
	}

	#releaseGeneratedTexture(key: GeneratedTextureKey): boolean {
		const texture = this.#generatedTextures.get(key);
		if (!texture) return false;
		this.#generatedTextures.delete(key);
		if (!this.#renderResources.releaseResource(texture.binding.resource)) {
			throw new Error(`Generated texture ${key} lost its backend resource.`);
		}
		return true;
	}

	#releaseAtlasTexture(texture: TextureAtlasEntryKey): boolean {
		const pageId = this.#atlasOwners.get(texture);
		if (pageId === undefined) return false;
		this.#atlasOwners.delete(texture);
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
}

function validateStandaloneTextureSource(
	source: StandaloneTextureSource,
): void {
	if (
		!standaloneTextureKeyMatchesSource(
			source.key,
			source.purpose,
			source.sourceAssetId,
		)
	) {
		throw new Error(
			`Standalone texture ${source.key} does not match its source facts.`,
		);
	}
	if (
		!Number.isInteger(source.width) ||
		!Number.isInteger(source.height) ||
		source.width <= 0 ||
		source.height <= 0
	) {
		throw new Error(
			`Standalone texture ${source.key} dimensions must be positive.`,
		);
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

function validateTextureArraySource(source: TextureArraySource): void {
	if (!textureArrayKeyMatchesPurpose(source.key, source.purpose)) {
		throw new Error(
			`Texture array ${source.key} does not match purpose ${source.purpose}.`,
		);
	}
	if (
		!Number.isInteger(source.width) ||
		!Number.isInteger(source.height) ||
		source.width <= 0 ||
		source.height <= 0
	) {
		throw new Error(`Texture array ${source.key} dimensions must be positive.`);
	}
	if (source.layers.length === 0) {
		throw new Error(
			`Texture array ${source.key} must contain at least one layer.`,
		);
	}
	const sourceIds = source.layers.map(({ sourceAssetId }) => sourceAssetId);
	if (new Set(sourceIds).size !== sourceIds.length) {
		throw new Error(
			`Texture array ${source.key} contains duplicate DAT sources.`,
		);
	}
}

function createTextureArrayResourceDescription(
	source: TextureArraySource,
): TextureArrayDescription {
	const purposePolicy = texturePurposePolicy(source.purpose);
	return {
		format: purposePolicy.format,
		height: source.height,
		layerCapacity: source.layers.length,
		mipLevels: purposePolicy.generateMipmaps
			? Math.floor(Math.log2(Math.max(source.width, source.height))) + 1
			: 1,
		width: source.width,
	};
}

function createTexture2DUpload(
	source: StandaloneTextureSource,
): Texture2DUpload {
	const purposePolicy = texturePurposePolicy(source.purpose);
	return {
		data: source.pixels,
		format: purposePolicy.format,
		height: source.height,
		mipLevels: mipLevelCount(source.purpose, source.width, source.height),
		width: source.width,
	};
}

function mipLevelCount(
	purpose: TexturePurpose,
	width: number,
	height: number,
): number {
	return texturePurposePolicy(purpose).generateMipmaps
		? Math.floor(Math.log2(Math.max(width, height))) + 1
		: 1;
}

function sameStandaloneTextureSource(
	left: StandaloneTextureIdentity,
	right: StandaloneTextureSource,
): boolean {
	return (
		left.sourceAssetId === right.sourceAssetId &&
		left.purpose === right.purpose &&
		left.width === right.width &&
		left.height === right.height
	);
}

function sameTextureArraySource(
	left: TextureArrayIdentity,
	right: TextureArraySource,
): boolean {
	return (
		left.purpose === right.purpose &&
		left.width === right.width &&
		left.height === right.height &&
		left.sourceAssetIds.length === right.layers.length &&
		left.sourceAssetIds.every(
			(sourceAssetId, layer) =>
				sourceAssetId === right.layers[layer]?.sourceAssetId,
		)
	);
}

function generatedTextureIdentity(
	upload: Texture2DUpload,
): GeneratedTextureIdentity {
	return {
		format: upload.format,
		height: upload.height,
		mipLevels: upload.mipLevels,
		width: upload.width,
	};
}

function sameGeneratedTextureIdentity(
	left: GeneratedTextureIdentity,
	right: GeneratedTextureIdentity,
): boolean {
	return (
		left.format === right.format &&
		left.width === right.width &&
		left.height === right.height &&
		left.mipLevels === right.mipLevels
	);
}
