import type { AssetService } from "../assets/contracts";
import {
	createPreparedTextureHostKey,
	prepareDirectRgbaTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	DomainAtlasSnapshot,
	PreparedTextureUseIdentity,
	StaticScopePayload,
	StaticTextureUseIdentity,
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
	StaticDomain,
} from "../static/contracts";
import { ShelfTexturePacker, type TexturePacker } from "./packing/packer";

interface TextureManagerOptions {
	readonly assetService: AssetService;
	readonly texturePacker?: TexturePacker;
}

export class TextureManager {
	readonly #assetService: AssetService;
	readonly #texturePacker: TexturePacker;
	readonly #domainRegistries = new Map<StaticDomain, DomainTextureRegistry>();
	readonly #textureKeysByDrawUnitId = new Map<string, Set<DomainTextureKey>>();
	#revision = 0;

	constructor(options: TextureManagerOptions) {
		this.#assetService = options.assetService;
		this.#texturePacker = options.texturePacker ?? new ShelfTexturePacker();
	}

	createDomainAtlasSnapshot(payload: StaticScopePayload): DomainAtlasSnapshot {
		const textureUses = collectPayloadTextureUses(payload);
		const registry = this.#getRegistry(payload.job.domain);

		return {
			domain: payload.job.domain,
			placements: textureUses.flatMap((textureUse) => {
				if (textureUse.kind !== "prepared-texture-use") {
					return [];
				}

				const entry = registry.entries.get(
					createDomainTextureKey(payload.job.domain, textureUse),
				);
				return entry
					? [
							{
								placementRevision: entry.placementRevision,
								texture: entry.source,
							},
						]
					: [];
			}),
			revision: registry.revision,
			textureUses,
		};
	}

	async applyStaticCommitDelta(
		delta: StaticCoordinatorCommitDelta,
	): Promise<TexturePlacementUpdate | null> {
		const removedTextureRefIds = this.#removeDrawUnitTextureRefs(
			delta.removedDrawUnitIds,
		);
		const placements: RuntimeTexturePlacement[] = [];
		const drawUnitBindings = [];
		const startingDomainRevisions = new Map<StaticDomain, number>();
		const dirtyDomains = new Set<StaticDomain>();

		for (const textureUse of delta.textureUses) {
			const placement = await this.#resolveDirectTexturePlacement(
				textureUse,
				startingDomainRevisions,
				dirtyDomains,
			);
			if (placement.created) {
				placements.push(placement.placement);
			}

			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				let textureKeys = this.#textureKeysByDrawUnitId.get(drawUnitId);
				if (!textureKeys) {
					textureKeys = new Set<DomainTextureKey>();
					this.#textureKeysByDrawUnitId.set(drawUnitId, textureKeys);
				}
				if (!textureKeys.has(placement.textureKey)) {
					textureKeys.add(placement.textureKey);
					placement.entry.leaseCount += 1;
				}
				drawUnitBindings.push({
					drawUnitId,
					textureRefId: placement.entry.textureRefId,
					textureUseId: textureUse.textureUseId,
				});
			}
		}

		for (const domain of dirtyDomains) {
			const registry = this.#getRegistry(domain);
			const startingRevision = startingDomainRevisions.get(domain) ?? registry.revision;
			registry.revision = startingRevision + 1;
		}

		if (
			placements.length === 0 &&
			removedTextureRefIds.length === 0 &&
			drawUnitBindings.length === 0
		) {
			return null;
		}

		this.#revision += 1;

		return {
			drawUnitBindings,
			placements,
			removedTextureRefIds,
			revision: this.#revision,
		};
	}

	#removeDrawUnitTextureRefs(
		removedDrawUnitIds: readonly string[],
	): readonly string[] {
		const removedTextureRefIds: string[] = [];

		for (const drawUnitId of removedDrawUnitIds) {
			const textureKeys = this.#textureKeysByDrawUnitId.get(drawUnitId);
			if (!textureKeys) {
				continue;
			}

			this.#textureKeysByDrawUnitId.delete(drawUnitId);
			for (const textureKey of textureKeys) {
				const entry = this.#findEntry(textureKey);
				if (!entry) {
					continue;
				}

				entry.leaseCount -= 1;
				if (entry.leaseCount > 0) {
					continue;
				}

				const registry = this.#getRegistry(entry.domain);
				registry.entries.delete(textureKey);
				registry.revision += 1;
				removedTextureRefIds.push(entry.textureRefId);
			}
		}

		return removedTextureRefIds;
	}

	async #resolveDirectTexturePlacement(
		textureUse: StaticBakeTextureUse,
		startingDomainRevisions: Map<StaticDomain, number>,
		dirtyDomains: Set<StaticDomain>,
	): Promise<ResolvedTexturePlacement> {
		const registry = this.#getRegistry(textureUse.domain);
		const startingRevision = getStartingDomainRevision(
			startingDomainRevisions,
			textureUse.domain,
			registry.revision,
		);
		const textureKey = createDomainTextureKey(textureUse.domain, textureUse.source);
		const existing = registry.entries.get(textureKey);
		if (existing) {
			return {
				created: false,
				entry: existing,
				textureKey,
			};
		}

		if (textureUse.placementRevisionAssumption !== startingRevision) {
			throw new Error(
				`Texture use ${textureUse.textureUseId} assumed ${textureUse.domain} atlas revision ${textureUse.placementRevisionAssumption}, but the active revision is ${startingRevision}.`,
			);
		}

		const prepared = await this.#assetService.requestPreparedAsset(
			createPreparedTextureHostKey(textureUse.source),
		);
		const source = prepareDirectRgbaTextureSource(prepared, textureUse.source);
		const placementRevision = startingRevision + 1;
		const textureRefId = createTextureRefId(textureUse.domain, textureUse.source);
		const packed = await this.#texturePacker.pack({
			domain: textureUse.domain,
			jobId: `texture-pack:${textureKey}`,
			page: {
				format: "rgba8",
				height: source.height,
				width: source.width,
			},
			placementRevision,
			sources: [
				{
					source,
					textureUseId: textureUse.textureUseId,
				},
			],
		});
		const page = packed.pages[0];
		const rect = packed.rects.find(
			(candidate) => candidate.textureUseId === textureUse.textureUseId,
		);
		if (!page || !rect) {
			throw new Error(
				`Texture packing job for ${textureUse.textureUseId} did not return a page and rect.`,
			);
		}

		const placement: RuntimeTexturePlacement = {
			format: page.format,
			height: page.height,
			kind: "direct-texture",
			pixels: page.pixels,
			placementRevision,
			rect: rect.rect,
			textureRefId,
			textureUseId: textureUse.textureUseId,
			width: page.width,
		};
		const entry: DomainTextureRegistryEntry = {
			domain: textureUse.domain,
			leaseCount: 0,
			placementRevision,
			source: textureUse.source,
			textureRefId,
		};
		registry.entries.set(textureKey, entry);
		dirtyDomains.add(textureUse.domain);
		return {
			created: true,
			entry,
			placement,
			textureKey,
		};
	}

	#getRegistry(domain: StaticDomain): DomainTextureRegistry {
		let registry = this.#domainRegistries.get(domain);
		if (!registry) {
			registry = {
				entries: new Map<DomainTextureKey, DomainTextureRegistryEntry>(),
				revision: 0,
			};
			this.#domainRegistries.set(domain, registry);
		}

		return registry;
	}

	#findEntry(textureKey: DomainTextureKey): DomainTextureRegistryEntry | null {
		for (const registry of this.#domainRegistries.values()) {
			const entry = registry.entries.get(textureKey);
			if (entry) {
				return entry;
			}
		}

		return null;
	}
}

type RuntimeTexturePlacement = TexturePlacementUpdate["placements"][number];

type DomainTextureKey = string & { readonly __brand: "DomainTextureKey" };

interface DomainTextureRegistry {
	revision: number;
	readonly entries: Map<DomainTextureKey, DomainTextureRegistryEntry>;
}

interface DomainTextureRegistryEntry {
	readonly domain: StaticDomain;
	readonly source: PreparedTextureUseIdentity;
	readonly textureRefId: string;
	readonly placementRevision: number;
	leaseCount: number;
}

type ResolvedTexturePlacement =
	| {
			readonly created: true;
			readonly textureKey: DomainTextureKey;
			readonly entry: DomainTextureRegistryEntry;
			readonly placement: RuntimeTexturePlacement;
	  }
	| {
			readonly created: false;
			readonly textureKey: DomainTextureKey;
			readonly entry: DomainTextureRegistryEntry;
	  };

function collectPayloadTextureUses(
	payload: StaticScopePayload,
): readonly StaticTextureUseIdentity[] {
	if (payload.scope.kind === "placeholder") {
		return payload.scope.referencedTextureUses;
	}
	if (payload.scope.kind === "terrain") {
		return payload.scope.textureUses.map(
			(textureUse) => textureUse.preparedTextureUse ?? textureUse.texture,
		);
	}

	return [];
}

function createDomainTextureKey(
	domain: StaticDomain,
	source: PreparedTextureUseIdentity,
): DomainTextureKey {
	return [
		domain,
		source.kind,
		source.renderSurfaceId.toString(16).padStart(8, "0"),
		source.usage,
		source.outputFormat,
		source.mipPolicy,
		source.colorSpace,
	].join(":") as DomainTextureKey;
}

function createTextureRefId(
	domain: StaticDomain,
	source: PreparedTextureUseIdentity,
): string {
	return [
		"texture-ref",
		domain,
		source.renderSurfaceId.toString(16).padStart(8, "0"),
		source.usage,
		source.outputFormat,
		source.mipPolicy,
		source.colorSpace,
	].join(":");
}

function getStartingDomainRevision(
	startingDomainRevisions: Map<StaticDomain, number>,
	domain: StaticDomain,
	currentRevision: number,
): number {
	const existing = startingDomainRevisions.get(domain);
	if (existing !== undefined) {
		return existing;
	}

	startingDomainRevisions.set(domain, currentRevision);
	return currentRevision;
}
