import type { AABB2 } from "../math/types";
import { log, LogLevel } from "../../logs";
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
	type AssetTextureFact,
	type AssetTextureKey,
	type TextureArrayFact,
	type TextureArrayKey,
	type TextureKey,
	type TextureFact,
	type TexturePreparation,
	type TexturePurpose,
	isTextureArrayKey,
	isGeneratedTextureKey,
	isAssetTextureKey,
	assetTextureKeyMatchesSource,
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
		readonly key: AssetTextureKey;
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
export interface AssetTextureSource {
	/** Logical identity derived from source and purpose. */
	readonly key: AssetTextureKey;
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

/** Backend atlas resource and page-relative placement for one logical texture. */
export interface TextureAtlasBinding {
	readonly resource: Texture2DResourceKey;
	readonly placement: TexturePlacement;
}

/** Read-only resource and arbitration counts for runtime diagnostics. */
export interface TextureManagerDiagnostics {
	readonly activeAtlasPages: number;
	readonly canonicalAtlasBindings: number;
	readonly publishedAtlasCandidates: number;
	readonly canonicalAtlasReplacements: number;
	readonly releasedAtlasPages: number;
}

/** One candidate texture placement exposed for Explorer atlas inspection. */
export interface TextureAtlasPageEntryDiagnostics {
	/** Whether this candidate is the currently selected physical binding. */
	readonly canonical: boolean;
	readonly key: AssetTextureKey;
	/** Page-relative pixel rectangle occupied by this texture. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Read-only physical page facts for Explorer atlas inspection. */
export interface TextureAtlasPageDiagnostics {
	readonly byteLength: number;
	readonly canonicalEntryCount: number;
	/** Area occupied by current canonical entries divided by the complete page area. */
	readonly canonicalOccupiedPixelRatio: number;
	readonly candidateEntryCount: number;
	/** Area occupied by every supplied candidate divided by the complete page area. */
	readonly candidateOccupiedPixelRatio: number;
	readonly entries: readonly TextureAtlasPageEntryDiagnostics[];
	readonly height: number;
	readonly pageId: TexturePageId;
	readonly purpose: TexturePurpose;
	readonly width: number;
}

/** Complete generated texture payload published directly by a CPU producer. */
export interface GeneratedTextureSource {
	readonly key: GeneratedTextureKey;
	readonly upload: Texture2DUpload;
}

interface PackedTexturePage {
	/** Every entry supplied by this independently packed candidate page. */
	readonly candidateTextures: ReadonlyMap<AssetTextureKey, TexturePlacement>;
	/** Candidate upload byte cost used by deterministic page arbitration. */
	readonly byteLength: number;
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	/** Entries this page currently wins as canonical physical bindings. */
	readonly textures: Map<AssetTextureKey, TexturePlacement>;
	readonly resource: Texture2DResourceKey;
}

function createAtlasPageDiagnostics(
	pageId: TexturePageId,
	page: PackedTexturePage,
): TextureAtlasPageDiagnostics {
	const entries = [...page.candidateTextures.entries()]
		.map(([key, placement]) => {
			const width = placement.bounds.max.x - placement.bounds.min.x;
			const height = placement.bounds.max.y - placement.bounds.min.y;
			return {
				canonical: page.textures.has(key),
				height,
				key,
				width,
				x: placement.bounds.min.x,
				y: placement.bounds.min.y,
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
	const pageArea = page.width * page.height;
	const candidateOccupiedArea = entries.reduce(
		(total, entry) => total + entry.width * entry.height,
		0,
	);
	const canonicalOccupiedArea = entries.reduce(
		(total, entry) =>
			entry.canonical ? total + entry.width * entry.height : total,
		0,
	);
	return {
		byteLength: page.byteLength,
		canonicalEntryCount: page.textures.size,
		canonicalOccupiedPixelRatio: canonicalOccupiedArea / pageArea,
		candidateEntryCount: entries.length,
		candidateOccupiedPixelRatio: candidateOccupiedArea / pageArea,
		entries,
		height: page.height,
		pageId,
		purpose: page.purpose,
		width: page.width,
	};
}

/** Owns preparation, device resources, and shared owner retention for logical textures. */
export class TextureManager<TOwnerId extends string = string> {
	readonly #renderResources: RendererResourceManager;
	readonly #preparer: TexturePreparer;
	readonly #leases = new LeaseRegistry<TOwnerId, TextureKey>();
	readonly #atlasOwners = new Map<AssetTextureKey, TexturePageId>();
	readonly #atlasPages = new Map<TexturePageId, PackedTexturePage>();
	#publishedAtlasCandidates = 0;
	#canonicalAtlasReplacements = 0;
	#releasedAtlasPages = 0;
	/** Complete standalone and generated two-dimensional device resources by logical key. */
	readonly #texture2DResources = new Map<
		AssetTextureKey | GeneratedTextureKey,
		Texture2DResourceKey
	>();
	/** Complete texture-array resources and their DAT-source layer assignments. */
	readonly #textureArrays = new Map<TextureArrayKey, TextureArrayBinding>();

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
		this.reserveKeys(
			owner,
			description.textures.map(({ key }) => key),
		);
		this.upsertAtlasPage(id, description);
	}

	/** Install one caller-prepared standalone asset texture under an explicit owner. */
	installAssetTexture(owner: TOwnerId, source: AssetTextureSource): void {
		this.reserveKeys(owner, [source.key]);
		this.#createAssetTexture(source);
	}

	/**
	 * Retain texture facts for one owner and materialize missing device resources.
	 * Preparation failures are terminal for that owner's texture set.
	 */
	async retain(owner: TOwnerId, facts: readonly TextureFact[]): Promise<void> {
		const newlyRetained = facts
			.filter(({ key }) => this.#leases.addLease(owner, key))
			.map(({ key }) => key);
		try {
			await Promise.all(facts.map((fact) => this.#materialize(fact)));
		} catch (error) {
			// An owner can also reserve generated textures before its asset facts materialize. Roll back
			// only this retain operation so an asset failure cannot evict those independent resources.
			this.#dropKeys(owner, newlyRetained);
			log(error, LogLevel.Error);
		}
	}

	/** Reserve logical keys whose texture payload may be published later by another producer. */
	reserveKeys(owner: TOwnerId, keys: readonly TextureKey[]): void {
		for (const key of keys) this.#leases.addLease(owner, key);
	}

	/**
	 * Materialize complete generated textures only while at least one owner reserves their keys.
	 * Repeated publication for an idempotent key is a no-op.
	 */
	upsertGeneratedTextures(sources: readonly GeneratedTextureSource[]): void {
		const created: Array<{
			readonly key: GeneratedTextureKey;
			readonly resource: Texture2DResourceKey;
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
				if (this.#texture2DResources.has(source.key)) continue;
				pendingKeys.add(source.key);
				created.push({
					key: source.key,
					resource: this.#renderResources.createTexture2D(source.upload),
				});
			}
			for (const texture of created) {
				this.#texture2DResources.set(texture.key, texture.resource);
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
		this.#releaseEmptyLeases();
	}

	/** Stop preparation work and release every texture retained by runtime owners. */
	async destroy(): Promise<void> {
		await this.#preparer.destroy();
		for (const owner of [...this.#leases.iterOwners()]) this.dropOwner(owner);
	}

	/** Return only aggregate atlas facts; physical bindings remain runtime-private. */
	getDiagnostics(): TextureManagerDiagnostics {
		return {
			activeAtlasPages: this.#atlasPages.size,
			canonicalAtlasBindings: this.#atlasOwners.size,
			canonicalAtlasReplacements: this.#canonicalAtlasReplacements,
			publishedAtlasCandidates: this.#publishedAtlasCandidates,
			releasedAtlasPages: this.#releasedAtlasPages,
		};
	}

	/**
	 * Return inspectable page facts without exposing backend resources or retaining page pixels.
	 *
	 * Atlas pixels are intentionally released after upload; diagnostics must not turn the
	 * Explorer into a hidden CPU-side texture cache.
	 */
	getAtlasPageDiagnostics(): readonly TextureAtlasPageDiagnostics[] {
		return [...this.#atlasPages.entries()]
			.map(([pageId, page]) => createAtlasPageDiagnostics(pageId, page))
			.sort((left, right) => left.pageId.localeCompare(right.pageId));
	}

	/** Return the opaque device resource for one currently active page inspection. */
	getAtlasPageResource(pageId: TexturePageId): Texture2DResourceKey {
		const page = this.#atlasPages.get(pageId);
		if (!page) throw new Error(`Texture page ${pageId} is no longer active.`);
		return page.resource;
	}

	upsertAtlasPage(
		id: TexturePageId,
		description: TexturePageDescription,
	): boolean {
		validatePage(description, id);
		const existing = this.#atlasPages.get(id);
		if (existing) {
			throw new Error(
				`Atlas page ${id} cannot be replaced while page arbitration is active.`,
			);
		}
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
		const resource = this.#renderResources.createTexture2D(upload);
		const candidateTextures = new Map(
			description.textures.map(({ key, placement }) => [key, placement]),
		);
		const candidate: PackedTexturePage = {
			byteLength: description.pageBits.byteLength,
			candidateTextures,
			height: description.height,
			purpose: description.purpose,
			resource,
			textures: new Map(),
			width: description.width,
		};
		this.#atlasPages.set(id, candidate);
		this.#publishedAtlasCandidates += 1;
		for (const [key, placement] of candidateTextures) {
			if (!this.#leases.hasLease(key)) continue;
			const incumbentId = this.#atlasOwners.get(key);
			const incumbent = incumbentId
				? this.#atlasPages.get(incumbentId)
				: undefined;
			if (incumbent && !this.#candidateBeats(candidate, incumbent)) continue;
			if (incumbent && incumbentId) {
				incumbent.textures.delete(key);
				this.#canonicalAtlasReplacements += 1;
				this.#releaseAtlasPageIfUnused(incumbentId, incumbent);
			}
			candidate.textures.set(key, placement);
			this.#atlasOwners.set(key, id);
			this.#releaseDegenerateTexture(key);
		}
		this.#releaseAtlasPageIfUnused(id, candidate);
		return true;
	}

	#createAssetTexture(source: AssetTextureSource): void {
		validateAssetTextureSource(source);
		if (this.#atlasOwners.has(source.key)) return;
		if (this.#texture2DResources.has(source.key)) return;

		const resource = this.#renderResources.createTexture2D(
			createTexture2DUpload(source),
		);
		this.#texture2DResources.set(source.key, resource);
	}

	#createTextureArray(source: TextureArraySource): void {
		validateTextureArraySource(source);
		if (this.#textureArrays.has(source.key)) return;

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
			layersByAssetId: new Map(
				source.layers.map(({ sourceAssetId }, layer) => [sourceAssetId, layer]),
			),
			resource,
		});
	}

	getAtlasBinding(texture: AssetTextureKey): TextureAtlasBinding {
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

	getTexture2DResource(
		key: AssetTextureKey | GeneratedTextureKey,
	): Texture2DResourceKey {
		if (isAssetTextureKey(key)) {
			const packed = this.#atlasOwners.get(key);
			if (packed !== undefined) return this.getAtlasBinding(key).resource;
		}
		const texture = this.#texture2DResources.get(key);
		if (!texture) throw new Error(`Texture ${key} does not exist.`);
		return texture;
	}

	getTextureArrayBinding(key: TextureArrayKey): TextureArrayBinding {
		const array = this.#textureArrays.get(key);
		if (!array) throw new Error(`Texture array ${key} does not exist.`);
		return array;
	}

	/** Check whether a complete logical texture is currently device-backed. */
	hasTexture(key: TextureKey): boolean {
		if (isTextureArrayKey(key)) return this.#textureArrays.has(key);
		if (isAssetTextureKey(key)) {
			return this.#atlasOwners.has(key) || this.#texture2DResources.has(key);
		}
		if (isGeneratedTextureKey(key)) {
			return this.#texture2DResources.has(key);
		}
		return this.#atlasOwners.has(key);
	}

	#releaseTexture(key: TextureKey): boolean {
		if (isTextureArrayKey(key)) return this.#releaseTextureArray(key);
		if (isAssetTextureKey(key)) {
			return this.#atlasOwners.has(key)
				? this.#releaseAtlasTexture(key)
				: this.#releaseTexture2D(key);
		}
		if (isGeneratedTextureKey(key)) {
			return this.#releaseTexture2D(key);
		}
		throw new Error(`Unknown texture key ${key}.`);
	}

	#dropKeys(owner: TOwnerId, keys: readonly TextureKey[]): void {
		for (const key of keys) this.#leases.dropLease(owner, key);
		this.#releaseEmptyLeases();
	}

	#releaseEmptyLeases(): void {
		for (const key of this.#leases.takeEmptyLeases()) this.#releaseTexture(key);
	}

	async #materialize(fact: TextureFact): Promise<void> {
		if (this.hasTexture(fact.key)) return;
		const source = await this.#preparer.prepare(fact);
		if (!this.#leases.hasLease(fact.key)) return;
		if (fact.kind === "array") {
			this.#validatePreparedArraySource(fact, source);
			this.#createTextureArray(source);
		} else {
			this.#validatePreparedAssetSource(fact, source);
			this.#createAssetTexture(source);
		}
	}

	#validatePreparedArraySource(
		fact: TextureArrayFact,
		source: TextureArraySource | AssetTextureSource,
	): asserts source is TextureArraySource {
		if (source.key !== fact.key || source.purpose !== fact.purpose) {
			throw new Error(
				`Texture preparer returned incompatible source for ${fact.key}.`,
			);
		}
		if (!("layers" in source)) {
			throw new Error(`Texture preparer returned asset data for ${fact.key}.`);
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

	#validatePreparedAssetSource(
		fact: AssetTextureFact,
		source: TextureArraySource | AssetTextureSource,
	): asserts source is AssetTextureSource {
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

	#releaseTextureArray(key: TextureArrayKey): boolean {
		const array = this.#textureArrays.get(key);
		if (!array) return false;
		this.#textureArrays.delete(key);
		if (!this.#renderResources.releaseResource(array.resource)) {
			throw new Error(`Texture array ${key} lost its backend resource.`);
		}
		return true;
	}

	#releaseTexture2D(key: AssetTextureKey | GeneratedTextureKey): boolean {
		const texture = this.#texture2DResources.get(key);
		if (!texture) return false;
		this.#texture2DResources.delete(key);
		if (!this.#renderResources.releaseResource(texture)) {
			throw new Error(`Texture ${key} lost its backend resource.`);
		}
		return true;
	}

	#releaseAtlasTexture(texture: AssetTextureKey): boolean {
		const pageId = this.#atlasOwners.get(texture);
		if (pageId === undefined) return false;
		this.#atlasOwners.delete(texture);
		const page = this.#atlasPages.get(pageId);
		if (!page) {
			throw new Error(`Texture ${texture} references missing page ${pageId}.`);
		}
		page.textures.delete(texture);
		this.#releaseAtlasPageIfUnused(pageId, page);
		return true;
	}

	#candidateBeats(
		candidate: PackedTexturePage,
		incumbent: PackedTexturePage,
	): boolean {
		const candidateScore = this.#pageScore(candidate);
		const incumbentScore = this.#pageScore(incumbent);
		if (candidateScore.coverage !== incumbentScore.coverage) {
			return candidateScore.coverage > incumbentScore.coverage;
		}
		if (candidateScore.consolidation !== incumbentScore.consolidation) {
			return candidateScore.consolidation > incumbentScore.consolidation;
		}
		if (candidateScore.byteLength !== incumbentScore.byteLength) {
			return candidateScore.byteLength < incumbentScore.byteLength;
		}
		if (candidateScore.occupiedArea !== incumbentScore.occupiedArea) {
			return candidateScore.occupiedArea > incumbentScore.occupiedArea;
		}
		return false;
	}

	#pageScore(page: PackedTexturePage): {
		readonly coverage: number;
		readonly consolidation: number;
		readonly byteLength: number;
		readonly occupiedArea: number;
	} {
		const retainedKeys = [...page.candidateTextures.keys()].filter((key) =>
			this.#leases.hasLease(key),
		);
		const candidateKeys = new Set(retainedKeys);
		const redundantPages = new Set<TexturePageId>();
		for (const key of retainedKeys) {
			const owner = this.#atlasOwners.get(key);
			if (owner) redundantPages.add(owner);
		}
		let consolidation = 0;
		for (const pageId of redundantPages) {
			const existing = this.#atlasPages.get(pageId);
			if (
				existing &&
				[...existing.textures.keys()].every((key) => candidateKeys.has(key))
			) {
				consolidation += 1;
			}
		}
		const occupiedArea = retainedKeys.reduce((total, key) => {
			const bounds = page.candidateTextures.get(key)!.bounds;
			return (
				total + (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y)
			);
		}, 0);
		return {
			byteLength: page.byteLength,
			consolidation,
			coverage: retainedKeys.length,
			occupiedArea,
		};
	}

	#releaseDegenerateTexture(key: AssetTextureKey): void {
		const resource = this.#texture2DResources.get(key);
		if (!resource) return;
		this.#texture2DResources.delete(key);
		if (!this.#renderResources.releaseResource(resource)) {
			throw new Error(
				`Packed texture ${key} lost its replaced degenerate binding.`,
			);
		}
	}

	#releaseAtlasPageIfUnused(id: TexturePageId, page: PackedTexturePage): void {
		if (page.textures.size > 0) return;
		this.#atlasPages.delete(id);
		this.#releasedAtlasPages += 1;
		if (!this.#renderResources.releaseResource(page.resource)) {
			throw new Error(`Texture page ${id} lost its backend resource.`);
		}
	}
}

function validateAssetTextureSource(source: AssetTextureSource): void {
	if (
		!assetTextureKeyMatchesSource(
			source.key,
			source.purpose,
			source.sourceAssetId,
		)
	) {
		throw new Error(
			`Asset texture ${source.key} does not match its source facts.`,
		);
	}
	if (
		!Number.isInteger(source.width) ||
		!Number.isInteger(source.height) ||
		source.width <= 0 ||
		source.height <= 0
	) {
		throw new Error(`Asset texture ${source.key} dimensions must be positive.`);
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

function createTexture2DUpload(source: AssetTextureSource): Texture2DUpload {
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
