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
import { AtlasTexturePacker, type TexturePacker } from "./packing/packer";
import type { TexturePackingJob } from "./packing/protocol";
import {
	createRuntimeTexturePagePolicy,
	createRuntimeTextureSamplerPolicy,
	type TextureFilteringMode,
	type RuntimeTexturePagePolicy,
	type RuntimeTextureSamplerPolicy,
} from "./sampling-policy";

const FILTERABLE_ATLAS_GUTTER_PIXELS = 4;
const EXACT_ATLAS_GUTTER_PIXELS = 0;

interface TextureManagerOptions {
	readonly assetService: AssetService;
	readonly filteringMode?: TextureFilteringMode;
	readonly texturePacker?: TexturePacker;
}

export class TextureManager {
	readonly #assetService: AssetService;
	readonly #filteringMode: TextureFilteringMode;
	readonly #texturePacker: TexturePacker;
	readonly #domainRegistries = new Map<StaticDomain, DomainTextureRegistry>();
	readonly #textureKeysByDrawUnitId = new Map<string, Set<DomainTextureKey>>();
	#revision = 0;

	constructor(options: TextureManagerOptions) {
		this.#assetService = options.assetService;
		this.#filteringMode = options.filteringMode ?? "anisotropic-4x";
		this.#texturePacker = options.texturePacker ?? new AtlasTexturePacker();
	}

	dispose(): void {
		this.#texturePacker.dispose?.();
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
		const pendingPlacements = new Map<
			DomainTextureKey,
			PendingTexturePlacement
		>();

		for (const textureUse of delta.textureUses) {
			const placement = await this.#stageTexturePlacement(
				textureUse,
				startingDomainRevisions,
				pendingPlacements,
			);
			const entry = placement.entry ?? null;

			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				let textureKeys = this.#textureKeysByDrawUnitId.get(drawUnitId);
				if (!textureKeys) {
					textureKeys = new Set<DomainTextureKey>();
					this.#textureKeysByDrawUnitId.set(drawUnitId, textureKeys);
				}
				if (!textureKeys.has(placement.textureKey)) {
					textureKeys.add(placement.textureKey);
					if (entry) {
						entry.leaseCount += 1;
					} else {
						placement.pendingLeaseCount += 1;
					}
				}
			}
		}

		const packedPlacements = await this.#packPendingTexturePlacements(
			[...pendingPlacements.values()],
			startingDomainRevisions,
			dirtyDomains,
		);
		placements.push(...packedPlacements);

		for (const placement of pendingPlacements.values()) {
			const entry = placement.entry;
			if (!entry) {
				throw new Error(
					`Texture placement ${placement.textureUse.textureUseId} was not committed after packing.`,
				);
			}
			entry.leaseCount += placement.pendingLeaseCount;
		}

		for (const textureUse of delta.textureUses) {
			const textureKey = createDomainTextureKey(
				textureUse.domain,
				textureUse.source,
			);
			const entry =
				this.#getRegistry(textureUse.domain).entries.get(textureKey) ??
				pendingPlacements.get(textureKey)?.entry;
			if (!entry) {
				continue;
			}
			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				drawUnitBindings.push({
					drawUnitId,
					rect: entry.rect,
					textureHeight: entry.textureHeight,
					textureRefId: entry.textureRefId,
					textureWidth: entry.textureWidth,
					textureUseId: textureUse.textureUseId,
				});
			}
		}

		for (const domain of dirtyDomains) {
			const registry = this.#getRegistry(domain);
			const startingRevision =
				startingDomainRevisions.get(domain) ?? registry.revision;
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
				if (!this.#hasTextureRef(entry.textureRefId)) {
					removedTextureRefIds.push(entry.textureRefId);
				}
			}
		}

		return removedTextureRefIds;
	}

	async #stageTexturePlacement(
		textureUse: StaticBakeTextureUse,
		startingDomainRevisions: Map<StaticDomain, number>,
		pendingPlacements: Map<DomainTextureKey, PendingTexturePlacement>,
	): Promise<StagedTexturePlacement> {
		const registry = this.#getRegistry(textureUse.domain);
		const startingRevision = getStartingDomainRevision(
			startingDomainRevisions,
			textureUse.domain,
			registry.revision,
		);
		const textureKey = createDomainTextureKey(
			textureUse.domain,
			textureUse.source,
		);
		const existing = registry.entries.get(textureKey);
		if (existing) {
			return {
				entry: existing,
				pendingLeaseCount: 0,
				textureKey,
			};
		}

		if (textureUse.placementRevisionAssumption !== startingRevision) {
			throw new Error(
				`Texture use ${textureUse.textureUseId} assumed ${textureUse.domain} atlas revision ${textureUse.placementRevisionAssumption}, but the active revision is ${startingRevision}.`,
			);
		}
		const pending = pendingPlacements.get(textureKey);
		if (pending) {
			return pending;
		}

		const prepared = await this.#assetService.requestPreparedAsset(
			createPreparedTextureHostKey(textureUse.source),
		);
		const source = prepareDirectRgbaTextureSource(prepared, textureUse.source);
		const pagePolicy = createRuntimeTexturePagePolicy(textureUse.source);
		const samplerPolicy = createRuntimeTextureSamplerPolicy({
			filteringMode: this.#filteringMode,
			sampleClass: pagePolicy.sampleClass,
		});
		const staged: PendingTexturePlacement = {
			domain: textureUse.domain,
			entry: null,
			pagePolicy,
			pendingLeaseCount: 0,
			samplerPolicy,
			source,
			textureKey,
			textureUse,
		};
		pendingPlacements.set(textureKey, staged);

		return staged;
	}

	async #packPendingTexturePlacements(
		pendingPlacements: readonly PendingTexturePlacement[],
		startingDomainRevisions: Map<StaticDomain, number>,
		dirtyDomains: Set<StaticDomain>,
	): Promise<readonly RuntimeTexturePlacement[]> {
		const runtimePlacements: RuntimeTexturePlacement[] = [];
		for (const group of groupPendingTexturePlacements(pendingPlacements)) {
			const startingRevision =
				startingDomainRevisions.get(group.domain) ??
				this.#getRegistry(group.domain).revision;
			const placementRevision = startingRevision + 1;
			const packed = await this.#texturePacker.pack({
				cohorts: [
					{
						key: group.pageClassKey,
						textureUseIds: group.entries.map(
							(entry) => entry.textureUse.textureUseId,
						),
					},
				],
				domain: group.domain,
				jobId: `texture-pack:${group.pageClassKey}:${placementRevision}`,
				page: createTexturePackingPageConstraints(group.entries),
				placementRevision,
				sources: group.entries.map((entry) => ({
					source: entry.source,
					textureUseId: entry.textureUse.textureUseId,
				})),
			});
			const pageById = new Map(packed.pages.map((page) => [page.pageId, page]));
			const rectByTextureUseId = new Map(
				packed.rects.map((rect) => [rect.textureUseId, rect] as const),
			);
			const entriesByPageId = new Map<string, PendingTexturePlacement[]>();

			for (const entry of group.entries) {
				const rect = rectByTextureUseId.get(entry.textureUse.textureUseId);
				if (!rect) {
					throw new Error(
						`Texture packing job for ${entry.textureUse.textureUseId} did not return a rect.`,
					);
				}
				const page = pageById.get(rect.pageId);
				if (!page) {
					throw new Error(
						`Texture packing job for ${entry.textureUse.textureUseId} returned unknown page ${rect.pageId}.`,
					);
				}
				const pageEntries = entriesByPageId.get(page.pageId) ?? [];
				pageEntries.push(entry);
				entriesByPageId.set(page.pageId, pageEntries);
			}

			for (const [pageId, pageEntries] of entriesByPageId) {
				const page = pageById.get(pageId);
				if (!page) {
					throw new Error(
						`Texture packing job returned unknown page ${pageId}.`,
					);
				}
				const firstEntry = pageEntries[0];
				if (!firstEntry) {
					continue;
				}
				const firstRect = rectByTextureUseId.get(
					firstEntry.textureUse.textureUseId,
				);
				if (!firstRect) {
					throw new Error(
						`Texture packing job for ${firstEntry.textureUse.textureUseId} did not return a rect.`,
					);
				}
				const textureRefId =
					pageEntries.length === 1
						? createTextureRefId(group.domain, firstEntry.textureUse.source)
						: createTexturePageRefId(group.domain, group.pageClassKey, pageId);
				runtimePlacements.push({
					anisotropy: group.samplerPolicy.anisotropy,
					filteringMode: group.samplerPolicy.filteringMode,
					format: page.format,
					height: page.height,
					kind: "direct-texture",
					mipmapsGenerated: group.samplerPolicy.generateMipmaps,
					pixels: page.pixels,
					placementRevision,
					rect: firstRect.rect,
					sampleClass: group.pagePolicy.sampleClass,
					samplerPolicyKey: group.samplerPolicy.policyKey,
					textureRefId,
					textureUseId: firstEntry.textureUse.textureUseId,
					wrapS: group.pagePolicy.wrapS,
					wrapT: group.pagePolicy.wrapT,
					width: page.width,
				});
				for (const entry of pageEntries) {
					const rect = rectByTextureUseId.get(entry.textureUse.textureUseId);
					if (!rect) {
						throw new Error(
							`Texture packing job for ${entry.textureUse.textureUseId} did not return a rect.`,
						);
					}
					entry.entry = {
						domain: entry.domain,
						leaseCount: 0,
						placementRevision,
						rect: rect.rect,
						source: entry.textureUse.source,
						textureHeight: page.height,
						textureRefId,
						textureWidth: page.width,
					};
					this.#getRegistry(entry.domain).entries.set(
						entry.textureKey,
						entry.entry,
					);
					dirtyDomains.add(entry.domain);
				}
			}
		}

		return runtimePlacements;
	}

	#hasTextureRef(textureRefId: string): boolean {
		for (const registry of this.#domainRegistries.values()) {
			for (const entry of registry.entries.values()) {
				if (entry.textureRefId === textureRefId) {
					return true;
				}
			}
		}

		return false;
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
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
	leaseCount: number;
}

type StagedTexturePlacement =
	| PendingTexturePlacement
	| ExistingTexturePlacement;

interface ExistingTexturePlacement {
	readonly textureKey: DomainTextureKey;
	readonly entry: DomainTextureRegistryEntry;
	pendingLeaseCount: 0;
}

interface PendingTexturePlacement {
	readonly domain: StaticDomain;
	readonly textureUse: StaticBakeTextureUse;
	readonly textureKey: DomainTextureKey;
	readonly source: ReturnType<typeof prepareDirectRgbaTextureSource>;
	readonly pagePolicy: RuntimeTexturePagePolicy;
	readonly samplerPolicy: RuntimeTextureSamplerPolicy;
	entry: DomainTextureRegistryEntry | null;
	pendingLeaseCount: number;
}

interface PendingTexturePlacementGroup {
	readonly domain: StaticDomain;
	readonly pageClassKey: string;
	readonly pagePolicy: RuntimeTexturePagePolicy;
	readonly samplerPolicy: RuntimeTextureSamplerPolicy;
	readonly entries: readonly PendingTexturePlacement[];
}

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
	].join(":");
}

function createTexturePageRefId(
	domain: StaticDomain,
	pageClassKey: string,
	pageId: string,
): string {
	return ["texture-page-ref", domain, pageClassKey, pageId].join(":");
}

function groupPendingTexturePlacements(
	placements: readonly PendingTexturePlacement[],
): readonly PendingTexturePlacementGroup[] {
	const groups = new Map<string, PendingTexturePlacementGroup>();
	for (const placement of placements) {
		const pageClassKey = createTexturePageClassKey(
			placement.pagePolicy,
			placement.samplerPolicy,
		);
		const groupKey = `${placement.domain}|${pageClassKey}`;
		const existing = groups.get(groupKey);
		if (existing) {
			groups.set(groupKey, {
				...existing,
				entries: [...existing.entries, placement],
			});
			continue;
		}

		groups.set(groupKey, {
			domain: placement.domain,
			entries: [placement],
			pageClassKey,
			pagePolicy: placement.pagePolicy,
			samplerPolicy: placement.samplerPolicy,
		});
	}

	return [...groups.values()];
}

function createTexturePageClassKey(
	pagePolicy: RuntimeTexturePagePolicy,
	samplerPolicy: RuntimeTextureSamplerPolicy,
): string {
	return [
		`sample:${pagePolicy.sampleClass}`,
		`wrap:${pagePolicy.wrapS},${pagePolicy.wrapT}`,
		`sampler:${samplerPolicy.policyKey}`,
	].join("|");
}

function createTexturePackingPageConstraints(
	entries: readonly PendingTexturePlacement[],
): TexturePackingJob["page"] {
	const gutterPixels = Math.max(
		...entries.map((entry) =>
			getRuntimeTexturePageGutterPixels(entry.pagePolicy),
		),
	);
	const paddedWidths = entries.map(
		(entry) => entry.source.width + gutterPixels * 2,
	);
	const paddedHeights = entries.map(
		(entry) => entry.source.height + gutterPixels * 2,
	);
	const totalPaddedArea = entries.reduce(
		(total, entry) =>
			total +
			(entry.source.width + gutterPixels * 2) *
				(entry.source.height + gutterPixels * 2),
		0,
	);
	const minSide = Math.max(
		1,
		...paddedWidths,
		...paddedHeights,
		Math.ceil(Math.sqrt(totalPaddedArea)),
	);
	const pageSide = Math.min(nextPowerOfTwo(minSide), 2048);

	return {
		format: "rgba8",
		gutterPixels,
		height: pageSide,
		pageSelection: "minimize-textures",
		width: pageSide,
	};
}

function getRuntimeTexturePageGutterPixels(
	pagePolicy: RuntimeTexturePagePolicy,
): number {
	return pagePolicy.sampleClass === "rgba-color" ||
		pagePolicy.sampleClass === "rgba-detail"
		? FILTERABLE_ATLAS_GUTTER_PIXELS
		: EXACT_ATLAS_GUTTER_PIXELS;
}

function nextPowerOfTwo(value: number): number {
	let power = 1;
	while (power < value) {
		power *= 2;
	}

	return power;
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
