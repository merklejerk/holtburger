import { log, LogLevel } from "../../logs";
import { LeaseRegistry } from "../ownership";
import type { ClosedWorkerPoolDiagnostics } from "../workers/closed-worker";
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
	readonly placement: {
		readonly bounds: import("../math/types").AABB2;
		readonly preparation: import("./types").TexturePreparation;
	};
}

/** Read-only resident-atlas facts for runtime diagnostics. */
export interface TextureManagerDiagnostics {
	readonly activeAtlasPages: number;
	readonly activeAtlasPageBytes: number;
	/** Largest simultaneously resident device-page allocation observed since runtime start. */
	readonly peakAtlasPageBytes: number;
	readonly avoidedAtlasPreparations: number;
	readonly compactedAtlasPagesEliminated: number;
	readonly acceptedAtlasCompactions: number;
	readonly attemptedAtlasCompactions: number;
	readonly failedAtlasCompactions: number;
	/** Completed page-build source copies transferred into the closed worker boundary. */
	readonly copiedAtlasSourceBytes: number;
	/** Complete fixed-page payload bytes submitted to the device resource manager. */
	readonly uploadedAtlasPageBytes: number;
	readonly uploadedAtlasPages: number;
	/** Device-page bytes and resources explicitly released after replacement or shutdown. */
	readonly releasedAtlasPageBytes: number;
	readonly releasedAtlasPages: number;
	/** Failed physical plan publications; optional compaction failures are included. */
	readonly failedAtlasTransactions: number;
	/** Layout results discarded because their purpose epoch was superseded. */
	readonly staleAtlasTransactions: number;
	/** Synchronous main-thread device publication and binding-swap duration. */
	readonly atlasPublicationDurationMs: number;
	readonly longestAtlasPublicationDurationMs: number;
	/** Closed-worker scheduling facts, separate from the synchronous publication measurements. */
	readonly atlasLayoutWorker: ClosedWorkerPoolDiagnostics | null;
	readonly atlasPageBuildWorker: ClosedWorkerPoolDiagnostics | null;
	readonly reusedAtlasInsertions: number;
	readonly residentAtlasBindings: number;
	readonly residentSourceBytes: number;
	readonly residentSourceCount: number;
	readonly pendingAtlasRequirements: number;
}

/** Read-only packed-atlas authority injected beside this generic texture facade. */
export interface PackedAtlasBindingDelegate {
	getAtlasBinding(texture: AssetTextureKey): TextureAtlasBinding | null;
	getAtlasDiagnostics(): TextureManagerDiagnostics;
	getAtlasPageDiagnostics(): readonly TextureAtlasPageDiagnostics[];
	getAtlasPageResource(pageId: TexturePageId): Texture2DResourceKey | null;
}

/** One resident texture placement exposed for Explorer atlas inspection. */
export interface TextureAtlasPageEntryDiagnostics {
	readonly key: AssetTextureKey;
	/** Page-relative pixel rectangle occupied by this texture. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Read-only resident page facts for Explorer atlas inspection. */
export interface TextureAtlasPageDiagnostics {
	/** Area occupied by content plus purpose-derived gutters divided by complete page area. */
	readonly allocatedPixelRatio: number;
	readonly byteLength: number;
	readonly entryCount: number;
	/** Largest immediately reusable free rectangle divided by complete page area. */
	readonly largestFreePixelRatio: number;
	/** Area occupied by resident content divided by complete page area. */
	readonly occupiedPixelRatio: number;
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

/** Owns preparation, device resources, and shared owner retention for logical textures. */
export class TextureManager<TOwnerId extends string = string> {
	readonly #renderResources: RendererResourceManager;
	readonly #preparer: TexturePreparer;
	readonly #packedAtlasDelegate: PackedAtlasBindingDelegate | null;
	readonly #leases = new LeaseRegistry<TOwnerId, TextureKey>();
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
		packedAtlasDelegate: PackedAtlasBindingDelegate | null = null,
	) {
		this.#renderResources = renderResources;
		this.#preparer = preparer;
		this.#packedAtlasDelegate = packedAtlasDelegate;
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

	/** Release generic texture consumers; the runtime owns shared preparer shutdown. */
	async destroy(): Promise<void> {
		for (const owner of [...this.#leases.iterOwners()]) this.dropOwner(owner);
	}

	/** Return only aggregate atlas facts; physical bindings remain runtime-private. */
	getDiagnostics(): TextureManagerDiagnostics {
		return this.#requireAtlasDelegate().getAtlasDiagnostics();
	}

	/**
	 * Return inspectable page facts without exposing backend resources or retaining page pixels.
	 *
	 * Atlas pixels are intentionally released after upload; diagnostics must not turn the
	 * Explorer into a hidden CPU-side texture cache.
	 */
	getAtlasPageDiagnostics(): readonly TextureAtlasPageDiagnostics[] {
		return this.#requireAtlasDelegate().getAtlasPageDiagnostics();
	}

	/** Return the opaque device resource for one currently active page inspection. */
	getAtlasPageResource(pageId: TexturePageId): Texture2DResourceKey {
		const resource = this.#requireAtlasDelegate().getAtlasPageResource(pageId);
		if (resource === null)
			throw new Error(`Texture page ${pageId} is no longer active.`);
		return resource;
	}

	#createAssetTexture(source: AssetTextureSource): void {
		validateAssetTextureSource(source);
		if (this.#packedAtlasDelegate?.getAtlasBinding(source.key)) return;
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
		const binding = this.#requireAtlasDelegate().getAtlasBinding(texture);
		if (binding === null)
			throw new Error(
				`Texture ${texture} does not have a resident atlas binding.`,
			);
		return binding;
	}

	getTexture2DResource(
		key: AssetTextureKey | GeneratedTextureKey,
	): Texture2DResourceKey {
		if (isAssetTextureKey(key)) {
			const delegated = this.#packedAtlasDelegate?.getAtlasBinding(key);
			if (delegated !== null && delegated !== undefined)
				return delegated.resource;
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
			const delegated = this.#packedAtlasDelegate?.getAtlasBinding(key);
			return (
				(delegated !== null && delegated !== undefined) ||
				this.#texture2DResources.has(key)
			);
		}
		if (isGeneratedTextureKey(key)) {
			return this.#texture2DResources.has(key);
		}
		return false;
	}

	#releaseTexture(key: TextureKey): boolean {
		if (isTextureArrayKey(key)) return this.#releaseTextureArray(key);
		if (isAssetTextureKey(key)) {
			return this.#releaseTexture2D(key);
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

	#requireAtlasDelegate(): PackedAtlasBindingDelegate {
		if (this.#packedAtlasDelegate === null) {
			throw new Error("Texture manager has no resident atlas authority.");
		}
		return this.#packedAtlasDelegate;
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
