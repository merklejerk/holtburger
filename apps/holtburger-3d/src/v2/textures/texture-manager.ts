import type { AssetService } from "../assets/contracts";
import { createHostAssetKey } from "../assets/keys";
import {
	createPreparedTextureHostKey,
	prepareDirectMaterialTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type {
	DirectMaterialTextureSource,
	DirectRgbaTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type {
	TerrainRolePageOverflowDiagnostics,
	TextureAtlasDiagnosticsReport,
} from "../runtime/diagnostics";
import type {
	SamplerPolicyUpdate,
	TextureDrawUnitBinding,
	TerrainTextureRolePageKind,
	TexturePlacementUpdate,
} from "../renderer/types";
import {
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../renderer/types";
import type {
	StaticAtlasBatchSnapshot,
	MaterialTextureDataUseIdentity,
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticScopePayload,
	StaticTextureUseIdentity,
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
	StaticDomain,
} from "../static/contracts";
import { AtlasTexturePacker, type TexturePacker } from "./packing/packer";
import type {
	TexturePackingJob,
	TexturePackingResult,
} from "./packing/protocol";
import {
	createRuntimeTexturePagePolicy,
	createRuntimeTextureSamplerPolicy,
	type TextureFilteringMode,
	type RuntimeTexturePagePolicy,
	type RuntimeTextureSamplerPolicy,
} from "./sampling-policy";

const FILTERABLE_ATLAS_GUTTER_PIXELS = 4;
const EXACT_ATLAS_GUTTER_PIXELS = 0;
const TERRAIN_COLOR_ATLAS_GUTTER_PIXELS = 96;
const TERRAIN_MASK_ATLAS_GUTTER_PIXELS = 16;
const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;
const TERRAIN_COLOR_ATLAS_FILL_RGBA = [128, 128, 128, 255] as const;
const RECENT_TERRAIN_ROLE_PAGE_OVERFLOW_LIMIT = 16;
const DEFAULT_TEXTURE_PACK_GROUP_MAX_CONCURRENCY = 8;

interface TextureManagerOptions {
	readonly assetService: AssetService;
	readonly filteringMode?: TextureFilteringMode;
	readonly packGroupMaxConcurrency?: number;
	readonly texturePacker?: TexturePacker;
}

export class TextureManager {
	readonly #assetService: AssetService;
	readonly #texturePacker: TexturePacker;
	readonly #packGroupMaxConcurrency: number;
	readonly #batchRegistries = new Map<
		StaticBatchRegistryKey,
		StaticBatchTextureRegistry
	>();
	readonly #textureKeysByDrawUnitId = new Map<
		string,
		Set<StaticBatchTextureKey>
	>();
	#recentRolePageOverflows: TerrainRolePageOverflowDiagnostics[] = [];
	#filteringMode: TextureFilteringMode;
	#revision = 0;

	constructor(options: TextureManagerOptions) {
		this.#assetService = options.assetService;
		this.#filteringMode = options.filteringMode ?? "anisotropic-4x";
		this.#texturePacker = options.texturePacker ?? new AtlasTexturePacker();
		this.#packGroupMaxConcurrency =
			options.packGroupMaxConcurrency ??
			DEFAULT_TEXTURE_PACK_GROUP_MAX_CONCURRENCY;
		assertPositiveInteger(
			this.#packGroupMaxConcurrency,
			"texture pack group max concurrency",
		);
	}

	get filteringMode(): TextureFilteringMode {
		return this.#filteringMode;
	}

	dispose(): void {
		this.#texturePacker.dispose?.();
	}

	setFilteringMode(
		filteringMode: TextureFilteringMode,
	): SamplerPolicyUpdate | null {
		if (this.#filteringMode === filteringMode) {
			return null;
		}

		this.#filteringMode = filteringMode;
		const policiesByTextureRefId = new Map<
			string,
			SamplerPolicyUpdate["policies"][number]
		>();

		for (const registry of this.#batchRegistries.values()) {
			for (const entry of uniqueSortedRegistryEntries(registry)) {
				const samplerPolicy = createRuntimeTextureSamplerPolicy({
					filteringMode,
					sampleClass: entry.sampleClass,
				});
				entry.anisotropy = samplerPolicy.anisotropy;
				entry.filteringMode = samplerPolicy.filteringMode;
				entry.mipmapsGenerated = samplerPolicy.generateMipmaps;
				entry.samplerPolicyKey = samplerPolicy.policyKey;
				policiesByTextureRefId.set(entry.textureRefId, {
					anisotropy: samplerPolicy.anisotropy,
					filteringMode: samplerPolicy.filteringMode,
					mipmapsGenerated: samplerPolicy.generateMipmaps,
					samplerPolicyKey: samplerPolicy.policyKey,
					textureRefId: entry.textureRefId,
				});
			}
		}

		if (policiesByTextureRefId.size === 0) {
			return null;
		}

		this.#revision += 1;

		return {
			policies: Array.from(policiesByTextureRefId.values()).sort(
				(left, right) => left.textureRefId.localeCompare(right.textureRefId),
			),
			revision: this.#revision,
		};
	}

	createDiagnosticsReport(): TextureAtlasDiagnosticsReport {
		const batches = Array.from(this.#batchRegistries.values())
			.sort((left, right) =>
				[left.domain, left.staticBatchId]
					.join("|")
					.localeCompare([right.domain, right.staticBatchId].join("|")),
			)
			.map((registry, index) =>
				createTextureAtlasBatchDiagnostics(registry, index),
			);
		const textureRefs = new Map<string, TextureAtlasPageFacts>();
		for (const batch of batches) {
			for (const page of batch.pages) {
				textureRefs.set(`${batch.batchId}:${page.pageId}`, page);
			}
		}
		const pages = batches.flatMap((batch) => batch.pages);
		const activeBatchCount = batches.filter(
			(batch) => batch.texturePageCount > 0,
		).length;

		return {
			byDomain: createTextureAtlasDomainDiagnostics(batches),
			kind: "texture-atlas",
			summary: {
				approximateBytes: sumNumbers(
					Array.from(textureRefs.values(), (page) => page.approximateBytes),
				),
				activeBatchCount,
				batchCount: batches.length,
				emptyBatchCount: batches.length - activeBatchCount,
				entryAliasCount: sumNumbers(
					batches.map((batch) => batch.entryAliasCount),
				),
				mipmappedPageCount: pages.filter((page) => page.mipmapsGenerated)
					.length,
				multiSourcePageCount: sumNumbers(
					batches.map((batch) => batch.multiSourcePageCount),
				),
				texturePageCount: textureRefs.size,
				unmippedPageCount: pages.filter((page) => !page.mipmapsGenerated)
					.length,
			},
			warnings: createTextureAtlasWarnings(this.#recentRolePageOverflows),
		};
	}

	createStaticAtlasBatchSnapshot(
		payloads: readonly StaticScopePayload[],
		staticBatchId: string,
	): StaticAtlasBatchSnapshot {
		const firstPayload = payloads[0];
		if (!firstPayload) {
			throw new Error(
				"Cannot create a static atlas batch snapshot without payloads.",
			);
		}
		const textureUses = payloads.flatMap((payload) =>
			collectPayloadTextureUses(payload),
		);
		const registry = this.#getRegistry(firstPayload.job.domain, staticBatchId);

		return {
			domain: firstPayload.job.domain,
			placements: textureUses.flatMap((textureUse) => {
				if (!isPreparedRgbaRenderSurfaceTextureUse(textureUse)) {
					return [];
				}

				const entry = findRegistryEntryBySource(
					registry,
					textureUse,
					createRuntimeTexturePagePolicy(textureUse),
				);
				return entry
					? [
							{
								texture: textureUse,
							},
						]
					: [];
			}),
			staticBatchId,
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
		const drawUnitBindings: TextureDrawUnitBinding[] = [];
		const rolePageSlots = new TerrainDrawUnitRolePageSlots((overflow) => {
			this.#recentRolePageOverflows = appendBounded(
				this.#recentRolePageOverflows,
				overflow,
				RECENT_TERRAIN_ROLE_PAGE_OVERFLOW_LIMIT,
			);
		});
		const pendingPlacements = new Map<string, PendingTexturePlacement>();

		for (const textureUse of delta.textureUses) {
			const staged = await this.#stageTexturePlacement(
				textureUse,
				pendingPlacements,
			);
			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				let textureKeys = this.#textureKeysByDrawUnitId.get(drawUnitId);
				if (!textureKeys) {
					textureKeys = new Set<StaticBatchTextureKey>();
					this.#textureKeysByDrawUnitId.set(drawUnitId, textureKeys);
				}
				if (!textureKeys.has(staged.textureKey)) {
					textureKeys.add(staged.textureKey);
					if (staged.entry) {
						staged.entry.leaseCount += 1;
					} else {
						staged.pending.pendingLeaseCount += 1;
					}
				}
			}
		}

		const packedPlacements = await this.#packPendingTexturePlacements(
			uniquePendingTexturePlacements(pendingPlacements),
		);
		placements.push(...packedPlacements);

		for (const placement of uniquePendingTexturePlacements(pendingPlacements)) {
			const entry = placement.entry;
			if (!entry) {
				throw new Error(
					`Texture placement ${placement.textureUse.textureUseId} was not committed after packing.`,
				);
			}
			entry.leaseCount += placement.pendingLeaseCount;
		}

		for (const textureUse of delta.textureUses) {
			const textureKey = createStaticBatchTextureKey(textureUse);
			const entry =
				this.#getRegistry(
					textureUse.domain,
					textureUse.staticBatchId,
				).entries.get(textureKey) ?? pendingPlacements.get(textureKey)?.entry;
			if (!entry) {
				continue;
			}
			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				const rolePage = resolveTextureRolePageSlot({
					domain: textureUse.domain,
					drawUnitId,
					rolePageSlots,
					source: textureUse.source,
					textureRefId: entry.textureRefId,
				});
				if (!rolePage) {
					continue;
				}
				drawUnitBindings.push({
					drawUnitId,
					rect: entry.rect,
					rolePage,
					textureHeight: entry.textureHeight,
					textureRefId: entry.textureRefId,
					textureWidth: entry.textureWidth,
					textureUseId: textureUse.textureUseId,
				});
			}
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

				const registry = this.#getRegistry(entry.domain, entry.staticBatchId);
				deleteRegistryEntryAliases(registry, entry);
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
		pendingPlacements: Map<string, PendingTexturePlacement>,
	): Promise<StagedTexturePlacement> {
		const source = textureUse.source;
		const registry = this.#getRegistry(
			textureUse.domain,
			textureUse.staticBatchId,
		);
		const textureKey = createStaticBatchTextureKey(textureUse);
		const existing = registry.entries.get(textureKey);
		if (existing) {
			return {
				entry: existing,
				textureKey,
			};
		}

		const pagePolicy = createRuntimeTexturePagePolicy(
			source,
			textureUse.samplingPolicy,
		);
		const existingSourceEntry = findRegistryEntryBySource(
			registry,
			source,
			pagePolicy,
		);
		if (existingSourceEntry) {
			registry.entries.set(textureKey, existingSourceEntry);
			return {
				entry: existingSourceEntry,
				textureKey,
			};
		}

		const placementKey = createStaticBatchSourcePlacementKey(textureUse);
		const pending = pendingPlacements.get(placementKey);
		if (pending) {
			addPendingPlacementOwners(pending, textureUse.ownerDrawUnitIds);
			pending.textureKeys.add(textureKey);
			pendingPlacements.set(textureKey, pending);
			return {
				entry: null,
				pending,
				textureKey,
			};
		}

		const prepared = await this.#assetService.requestPreparedAsset(
			createMaterialTextureHostKey(source),
		);
		const directSource = prepareDirectMaterialTextureSource(prepared, source);
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
			source: directSource,
			staticBatchId: textureUse.staticBatchId,
			textureKeys: new Set([textureKey]),
			textureUse,
			ownerDrawUnitIds: new Set(textureUse.ownerDrawUnitIds),
		};
		pendingPlacements.set(placementKey, staged);
		pendingPlacements.set(textureKey, staged);

		return {
			entry: null,
			pending: staged,
			textureKey,
		};
	}

	async #packPendingTexturePlacements(
		pendingPlacements: readonly PendingTexturePlacement[],
	): Promise<readonly RuntimeTexturePlacement[]> {
		const runtimePlacements: RuntimeTexturePlacement[] = [];
		const directPlacements = pendingPlacements.filter(shouldCommitDirectPlacement);
		runtimePlacements.push(
			...this.#commitDirectTexturePlacements(directPlacements),
		);
		const packablePlacements = pendingPlacements.filter(
			(placement) => !shouldCommitDirectPlacement(placement),
		);
		const plannedGroups = this.#planPendingTexturePackingGroups(
			groupPendingTexturePlacements(packablePlacements),
		);
		const packedGroups = await mapWithConcurrency(
			plannedGroups,
			this.#packGroupMaxConcurrency,
			async (plannedGroup) => ({
				...plannedGroup,
				packed: await this.#texturePacker.pack(plannedGroup.job),
			}),
		);

		for (const packedGroup of packedGroups) {
			runtimePlacements.push(
				...this.#commitPackedTexturePlacementGroup(packedGroup),
			);
		}

		return runtimePlacements;
	}

	#commitDirectTexturePlacements(
		placements: readonly PendingTexturePlacement[],
	): readonly RuntimeTexturePlacement[] {
		const runtimePlacements: RuntimeTexturePlacement[] = [];
		const nextRevisionByRegistry = new Map<StaticBatchRegistryKey, number>();

		for (const placement of placements) {
			const registryKey = createStaticBatchRegistryKey(
				placement.domain,
				placement.staticBatchId,
			);
			const currentRevision =
				nextRevisionByRegistry.get(registryKey) ??
				this.#getRegistry(placement.domain, placement.staticBatchId).revision;
			const placementRevision = currentRevision + 1;
			nextRevisionByRegistry.set(registryKey, placementRevision);

			const textureRefId = createTextureRefId(
				placement.domain,
				placement.staticBatchId,
				placement.textureUse,
			);
			const textureWidth = placement.source.width;
			const textureHeight = placement.source.height;
			const rect = [0, 0, textureWidth, textureHeight] as const;
			const registryEntry: StaticBatchTextureRegistryEntry = {
				anisotropy: placement.samplerPolicy.anisotropy,
				domain: placement.domain,
				filteringMode: placement.samplerPolicy.filteringMode,
				format: getTextureSourcePlacementFormat(placement.source),
				leaseCount: 0,
				mipmapsGenerated: placement.samplerPolicy.generateMipmaps,
				placementRevision,
				rect,
				sampleClass: placement.pagePolicy.sampleClass,
				samplerPolicyKey: placement.samplerPolicy.policyKey,
				source: placement.textureUse.source,
				staticBatchId: placement.staticBatchId,
				textureHeight,
				textureRefId,
				textureWidth,
				wrapS: placement.pagePolicy.wrapS,
				wrapT: placement.pagePolicy.wrapT,
			};
			placement.entry = registryEntry;
			for (const textureKey of placement.textureKeys) {
				this.#getRegistry(placement.domain, placement.staticBatchId).entries.set(
					textureKey,
					registryEntry,
				);
			}
			runtimePlacements.push({
				anisotropy: placement.samplerPolicy.anisotropy,
				filteringMode: placement.samplerPolicy.filteringMode,
				format: registryEntry.format,
				height: textureHeight,
				mipmapsGenerated: placement.samplerPolicy.generateMipmaps,
				pixels: getTextureSourcePlacementPixels(placement.source),
				placementRevision,
				rect,
				sampleClass: placement.pagePolicy.sampleClass,
				samplerPolicyKey: placement.samplerPolicy.policyKey,
				textureRefId,
				textureUseId: placement.textureUse.textureUseId,
				wrapS: placement.pagePolicy.wrapS,
				wrapT: placement.pagePolicy.wrapT,
				width: textureWidth,
			});
		}

		for (const [registryKey, revision] of nextRevisionByRegistry) {
			const registry = this.#batchRegistries.get(registryKey);
			if (registry) {
				registry.revision = Math.max(registry.revision, revision);
			}
		}

		return runtimePlacements;
	}

	#planPendingTexturePackingGroups(
		groups: readonly PendingTexturePlacementGroup[],
	): readonly PlannedPendingTexturePlacementGroup[] {
		const nextRevisionByRegistry = new Map<StaticBatchRegistryKey, number>();

		return groups.map((group) => {
			const registryKey = createStaticBatchRegistryKey(
				group.domain,
				group.staticBatchId,
			);
			const currentRevision =
				nextRevisionByRegistry.get(registryKey) ??
				this.#getRegistry(group.domain, group.staticBatchId).revision;
			const placementRevision = currentRevision + 1;
			nextRevisionByRegistry.set(registryKey, placementRevision);

			return {
				group,
				job: {
					cohorts: createTexturePackingCohorts(group),
					domain: group.domain,
					jobId: `texture-pack:${group.staticBatchId}:${group.pageClassKey}:${placementRevision}`,
					page: createTexturePackingPageConstraints(group),
					placementRevision,
					sources: group.entries.map((entry) => ({
						source: asDirectRgbaTextureSource(entry.source),
						textureUseId: entry.textureUse.textureUseId,
					})),
				},
				placementRevision,
			};
		});
	}

	#commitPackedTexturePlacementGroup(
		packedGroup: PackedPendingTexturePlacementGroup,
	): readonly RuntimeTexturePlacement[] {
		const { group, packed, placementRevision } = packedGroup;
		const runtimePlacements: RuntimeTexturePlacement[] = [];
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
				throw new Error(`Texture packing job returned unknown page ${pageId}.`);
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
					? createTextureRefId(
							group.domain,
							group.staticBatchId,
							firstEntry.textureUse,
						)
					: createTexturePageRefId(
							group.domain,
							group.staticBatchId,
							group.pageClassKey,
							pageId,
						);
			runtimePlacements.push({
				anisotropy: group.samplerPolicy.anisotropy,
				filteringMode: group.samplerPolicy.filteringMode,
				format: page.format,
				height: page.height,
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
				const registryEntry: StaticBatchTextureRegistryEntry = {
					anisotropy: group.samplerPolicy.anisotropy,
					domain: entry.domain,
					filteringMode: group.samplerPolicy.filteringMode,
					format: page.format,
					leaseCount: 0,
					mipmapsGenerated: group.samplerPolicy.generateMipmaps,
					placementRevision,
					rect: rect.rect,
					sampleClass: group.pagePolicy.sampleClass,
					samplerPolicyKey: group.samplerPolicy.policyKey,
					source: entry.textureUse.source,
					staticBatchId: entry.staticBatchId,
					textureHeight: page.height,
					textureRefId,
					textureWidth: page.width,
					wrapS: group.pagePolicy.wrapS,
					wrapT: group.pagePolicy.wrapT,
				};
				entry.entry = registryEntry;
				for (const textureKey of entry.textureKeys) {
					this.#getRegistry(entry.domain, entry.staticBatchId).entries.set(
						textureKey,
						registryEntry,
					);
				}
			}
		}

		const registry = this.#getRegistry(group.domain, group.staticBatchId);
		registry.revision = Math.max(registry.revision, placementRevision);

		return runtimePlacements;
	}

	#hasTextureRef(textureRefId: string): boolean {
		for (const registry of this.#batchRegistries.values()) {
			for (const entry of registry.entries.values()) {
				if (entry.textureRefId === textureRefId) {
					return true;
				}
			}
		}

		return false;
	}

	#getRegistry(
		domain: StaticDomain,
		staticBatchId: string,
	): StaticBatchTextureRegistry {
		const registryKey = createStaticBatchRegistryKey(domain, staticBatchId);
		let registry = this.#batchRegistries.get(registryKey);
		if (!registry) {
			registry = {
				domain,
				entries: new Map<
					StaticBatchTextureKey,
					StaticBatchTextureRegistryEntry
				>(),
				revision: 0,
				staticBatchId,
			};
			this.#batchRegistries.set(registryKey, registry);
		}

		return registry;
	}

	#findEntry(
		textureKey: StaticBatchTextureKey,
	): StaticBatchTextureRegistryEntry | null {
		for (const registry of this.#batchRegistries.values()) {
			const entry = registry.entries.get(textureKey);
			if (entry) {
				return entry;
			}
		}

		return null;
	}

}

type RuntimeTexturePlacement = TexturePlacementUpdate["placements"][number];

type StaticBatchRegistryKey = string & {
	readonly __brand: "StaticBatchRegistryKey";
};
type StaticBatchTextureKey = string & {
	readonly __brand: "StaticBatchTextureKey";
};

interface StaticBatchTextureRegistry {
	readonly domain: StaticDomain;
	readonly staticBatchId: string;
	revision: number;
	readonly entries: Map<StaticBatchTextureKey, StaticBatchTextureRegistryEntry>;
}

interface StaticBatchTextureRegistryEntry {
	anisotropy: number;
	readonly domain: StaticDomain;
	filteringMode: TextureFilteringMode;
	readonly format: RuntimeTexturePlacement["format"];
	readonly staticBatchId: string;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureRefId: string;
	readonly placementRevision: number;
	mipmapsGenerated: boolean;
	readonly sampleClass: RuntimeTexturePagePolicy["sampleClass"];
	samplerPolicyKey: string;
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
	readonly wrapS: RuntimeTexturePagePolicy["wrapS"];
	readonly wrapT: RuntimeTexturePagePolicy["wrapT"];
	leaseCount: number;
}

interface TextureAtlasBatchFacts {
	readonly batchId: string;
	readonly domain: StaticDomain;
	readonly entryAliasCount: number;
	readonly uniqueSourceCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly approximateBytes: number;
	readonly pages: readonly TextureAtlasPageFacts[];
}

interface TextureAtlasPageFacts {
	readonly pageId: string;
	readonly approximateBytes: number;
	readonly uniqueSourceCount: number;
	readonly sampleClass: RuntimeTexturePagePolicy["sampleClass"];
	readonly mipmapsGenerated: boolean;
	readonly wrapS: RuntimeTexturePagePolicy["wrapS"];
	readonly wrapT: RuntimeTexturePagePolicy["wrapT"];
}

type StagedTexturePlacement =
	| ExistingTexturePlacement
	| PendingStagedTexturePlacement;

interface ExistingTexturePlacement {
	readonly textureKey: StaticBatchTextureKey;
	readonly entry: StaticBatchTextureRegistryEntry;
}

interface PendingStagedTexturePlacement {
	readonly textureKey: StaticBatchTextureKey;
	readonly entry: null;
	readonly pending: PendingTexturePlacement;
}

interface PendingTexturePlacement {
	readonly domain: StaticDomain;
	readonly staticBatchId: string;
	readonly textureUse: StaticBakeTextureUse;
	readonly textureKeys: Set<StaticBatchTextureKey>;
	readonly source: DirectMaterialTextureSource;
	readonly pagePolicy: RuntimeTexturePagePolicy;
	readonly samplerPolicy: RuntimeTextureSamplerPolicy;
	readonly ownerDrawUnitIds: Set<string>;
	entry: StaticBatchTextureRegistryEntry | null;
	pendingLeaseCount: number;
}

interface PendingTexturePlacementGroup {
	readonly domain: StaticDomain;
	readonly staticBatchId: string;
	readonly pageClassKey: string;
	readonly pagePolicy: RuntimeTexturePagePolicy;
	readonly samplerPolicy: RuntimeTextureSamplerPolicy;
	readonly entries: readonly PendingTexturePlacement[];
}

interface PlannedPendingTexturePlacementGroup {
	readonly group: PendingTexturePlacementGroup;
	readonly job: TexturePackingJob;
	readonly placementRevision: number;
}

interface PackedPendingTexturePlacementGroup extends PlannedPendingTexturePlacementGroup {
	readonly packed: TexturePackingResult;
}

interface TerrainRolePageSlotInput {
	readonly drawUnitId: string;
	readonly textureRefId: string;
	readonly usage: MaterialTextureDataUseIdentity["usage"];
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

function createStaticBatchRegistryKey(
	domain: StaticDomain,
	staticBatchId: string,
): StaticBatchRegistryKey {
	return [domain, staticBatchId].join(":") as StaticBatchRegistryKey;
}

function findRegistryEntryBySource(
	registry: StaticBatchTextureRegistry,
	source: MaterialTextureDataUseIdentity,
	pagePolicy: RuntimeTexturePagePolicy,
): StaticBatchTextureRegistryEntry | null {
	for (const entry of registry.entries.values()) {
		if (
			isSameMaterialTextureDataUse(entry.source, source) &&
			entry.sampleClass === pagePolicy.sampleClass &&
			entry.wrapS === pagePolicy.wrapS &&
			entry.wrapT === pagePolicy.wrapT
		) {
			return entry;
		}
	}

	return null;
}

function uniqueSortedRegistryEntries(
	registry: StaticBatchTextureRegistry,
): readonly StaticBatchTextureRegistryEntry[] {
	return Array.from(new Set(registry.entries.values())).sort((left, right) =>
		left.textureRefId.localeCompare(right.textureRefId),
	);
}

function deleteRegistryEntryAliases(
	registry: StaticBatchTextureRegistry,
	entry: StaticBatchTextureRegistryEntry,
): void {
	for (const [textureKey, candidate] of registry.entries) {
		if (candidate === entry) {
			registry.entries.delete(textureKey);
		}
	}
}

function isSameMaterialTextureDataUse(
	left: MaterialTextureDataUseIdentity,
	right: MaterialTextureDataUseIdentity,
): boolean {
	if (left.kind !== right.kind || left.usage !== right.usage) {
		return false;
	}

	if (left.kind === "palette-texture-use" && right.kind === "palette-texture-use") {
		return (
			left.palette.paletteId === right.palette.paletteId &&
			left.firstIndex === right.firstIndex &&
			left.indexCount === right.indexCount
		);
	}

	if (
		left.kind === "prepared-render-surface-texture-use" &&
		right.kind === "prepared-render-surface-texture-use"
	) {
		return (
			left.renderSurface.renderSurfaceId ===
			right.renderSurface.renderSurfaceId
		);
	}

	return false;
}

function createMaterialTextureHostKey(source: MaterialTextureDataUseIdentity) {
	if (source.kind === "palette-texture-use") {
		return createHostAssetKey("palette", source.palette.paletteId);
	}

	return createPreparedTextureHostKey(source);
}

function shouldCommitDirectPlacement(
	placement: PendingTexturePlacement,
): boolean {
	return (
		placement.source.kind === "direct-index-texture-source" ||
		placement.source.kind === "direct-palette-texture-source"
	);
}

function asDirectRgbaTextureSource(
	source: DirectMaterialTextureSource,
): DirectRgbaTextureSource {
	if (source.kind === "direct-rgba-texture-source") {
		return source;
	}

	throw new Error(
		`Texture source ${source.kind} cannot be submitted to the RGBA atlas packer.`,
	);
}

function getTextureSourcePlacementFormat(
	source: DirectMaterialTextureSource,
): RuntimeTexturePlacement["format"] {
	if (source.kind === "direct-index-texture-source") {
		return source.usage === "index8" ? "r8ui" : "r16ui";
	}

	return "rgba8";
}

function getTextureSourcePlacementPixels(
	source: DirectMaterialTextureSource,
): Uint8Array {
	if (source.kind === "direct-index-texture-source") {
		return source.indices;
	}

	return source.pixels;
}

function createMaterialTextureDataUseKey(
	source: MaterialTextureDataUseIdentity,
): string {
	if (source.kind === "palette-texture-use") {
		return [
			source.kind,
			source.palette.paletteId.toString(16).padStart(8, "0"),
			`range:${source.firstIndex}-${source.indexCount}`,
			source.usage,
		].join(":");
	}

	return (
		[
			source.kind,
			source.renderSurface.renderSurfaceId.toString(16).padStart(8, "0"),
			source.usage,
		].join(":")
	);
}

function createStaticBatchTextureKey(
	textureUse: StaticBakeTextureUse,
): StaticBatchTextureKey {
	return [
		textureUse.domain,
		textureUse.staticBatchId,
		textureUse.textureUseId,
	].join(":") as StaticBatchTextureKey;
}

function createStaticBatchSourcePlacementKey(
	textureUse: StaticBakeTextureUse,
): string {
	return [
		textureUse.domain,
		textureUse.staticBatchId,
		createMaterialTextureDataUseKey(textureUse.source),
		createTextureUseSamplingKey(textureUse),
	].join(":");
}

function createTextureUseSamplingKey(textureUse: StaticBakeTextureUse): string {
	const samplingPolicy = textureUse.samplingPolicy;
	if (!samplingPolicy) {
		return "sampling:default";
	}

	return `sampling:wrap=${samplingPolicy.wrapS},${samplingPolicy.wrapT}`;
}

function isPreparedRgbaRenderSurfaceTextureUse(
	source: StaticTextureUseIdentity,
): source is PreparedRgbaRenderSurfaceTextureUseIdentity {
	return (
		source.kind === "prepared-render-surface-texture-use" &&
		(source.usage === "rgba-color" ||
			source.usage === "rgba-detail" ||
			source.usage === "rgba-mask" ||
			source.usage === "rgba-raw")
	);
}

function createTextureRefId(
	domain: StaticDomain,
	staticBatchId: string,
	textureUse: StaticBakeTextureUse,
): string {
	return ["texture-ref", domain, staticBatchId, textureUse.textureUseId].join(
		":",
	);
}

function createTexturePageRefId(
	domain: StaticDomain,
	staticBatchId: string,
	pageClassKey: string,
	pageId: string,
): string {
	return ["texture-page-ref", domain, staticBatchId, pageClassKey, pageId].join(
		":",
	);
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
		const groupKey = `${placement.domain}|${placement.staticBatchId}|${pageClassKey}`;
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
			staticBatchId: placement.staticBatchId,
		});
	}

	return [...groups.values()];
}

function uniquePendingTexturePlacements(
	placementsByKey: ReadonlyMap<string, PendingTexturePlacement>,
): readonly PendingTexturePlacement[] {
	return [...new Set(placementsByKey.values())];
}

function addPendingPlacementOwners(
	placement: PendingTexturePlacement,
	ownerDrawUnitIds: readonly string[],
): void {
	for (const ownerDrawUnitId of ownerDrawUnitIds) {
		placement.ownerDrawUnitIds.add(ownerDrawUnitId);
	}
}

async function mapWithConcurrency<Input, Output>(
	inputs: readonly Input[],
	maxConcurrency: number,
	map: (input: Input, index: number) => Promise<Output>,
): Promise<readonly Output[]> {
	assertPositiveInteger(maxConcurrency, "max concurrency");
	if (maxConcurrency === 1) {
		const results: Output[] = [];
		for (let index = 0; index < inputs.length; index += 1) {
			results.push(await map(inputs[index] as Input, index));
		}

		return results;
	}

	const results: Output[] = [];
	let nextIndex = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= inputs.length) {
				return;
			}

			const input = inputs[index] as Input;
			results[index] = await map(input, index);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(maxConcurrency, inputs.length) }, () =>
			worker(),
		),
	);

	return results;
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer. Received ${value}.`);
	}
}

function createTexturePackingCohorts(
	group: PendingTexturePlacementGroup,
): TexturePackingJob["cohorts"] {
	if (shouldUseIndependentTerrainPacking(group)) {
		return undefined;
	}

	const textureUseIdsByDrawUnitId = new Map<string, string[]>();
	for (const entry of group.entries) {
		for (const drawUnitId of entry.ownerDrawUnitIds) {
			const textureUseIds = textureUseIdsByDrawUnitId.get(drawUnitId) ?? [];
			textureUseIds.push(entry.textureUse.textureUseId);
			textureUseIdsByDrawUnitId.set(drawUnitId, textureUseIds);
		}
	}

	return [...textureUseIdsByDrawUnitId.entries()]
		.map(([drawUnitId, textureUseIds]) => ({
			key: `${group.pageClassKey}|draw-unit:${drawUnitId}`,
			textureUseIds: uniqueSortedStrings(textureUseIds),
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function shouldUseIndependentTerrainPacking(
	group: PendingTexturePlacementGroup,
): boolean {
	return (
		group.domain === "outdoor-terrain" &&
		(group.pagePolicy.sampleClass === "rgba-color" ||
			group.pagePolicy.sampleClass === "rgba-mask")
	);
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

function createTexturePackingPageConstraints({
	domain,
	entries,
	pagePolicy,
}: PendingTexturePlacementGroup): TexturePackingJob["page"] {
	const gutterPixels = Math.max(
		...entries.map((entry) =>
			getRuntimeTexturePageGutterPixels(domain, entry.pagePolicy),
		),
	);

	const shouldUseTerrainColorFill =
		domain === "outdoor-terrain" && pagePolicy.sampleClass === "rgba-color";

	return {
		...(shouldUseTerrainColorFill
			? { fillRgba: TERRAIN_COLOR_ATLAS_FILL_RGBA }
			: {}),
		format: "rgba8",
		gutterEdgeMode:
			pagePolicy.wrapS === "repeat" && pagePolicy.wrapT === "repeat"
				? "repeat"
				: "clamp",
		gutterPixels,
		height: MAX_RUNTIME_ATLAS_PAGE_SIZE,
		pageSelection: "minimize-textures",
		width: MAX_RUNTIME_ATLAS_PAGE_SIZE,
	};
}

function getRuntimeTexturePageGutterPixels(
	domain: StaticDomain,
	pagePolicy: RuntimeTexturePagePolicy,
): number {
	if (domain === "outdoor-terrain") {
		if (pagePolicy.sampleClass === "rgba-color") {
			return Math.max(
				FILTERABLE_ATLAS_GUTTER_PIXELS,
				TERRAIN_COLOR_ATLAS_GUTTER_PIXELS,
			);
		}

		if (pagePolicy.sampleClass === "rgba-mask") {
			return Math.max(
				EXACT_ATLAS_GUTTER_PIXELS,
				TERRAIN_MASK_ATLAS_GUTTER_PIXELS,
			);
		}
	}

	return pagePolicy.sampleClass === "rgba-color" ||
		pagePolicy.sampleClass === "rgba-detail"
		? FILTERABLE_ATLAS_GUTTER_PIXELS
		: EXACT_ATLAS_GUTTER_PIXELS;
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createTextureAtlasBatchDiagnostics(
	registry: StaticBatchTextureRegistry,
	batchIndex: number,
): TextureAtlasBatchFacts {
	const entries = Array.from(registry.entries.values());
	const pages = createTextureAtlasPageDiagnostics(entries);

	return {
		approximateBytes: sumNumbers(pages.map((page) => page.approximateBytes)),
		batchId: `batch-${batchIndex + 1}`,
		domain: registry.domain,
		entryAliasCount: registry.entries.size,
		multiSourcePageCount: pages.filter((page) => page.uniqueSourceCount > 1)
			.length,
		pages,
		texturePageCount: pages.length,
		uniqueSourceCount: countUniqueSources(entries),
	};
}

function createTextureAtlasPageDiagnostics(
	entries: readonly StaticBatchTextureRegistryEntry[],
): readonly TextureAtlasPageFacts[] {
	const entriesByTextureRef = new Map<
		string,
		StaticBatchTextureRegistryEntry[]
	>();
	for (const entry of entries) {
		const pageEntries = entriesByTextureRef.get(entry.textureRefId) ?? [];
		pageEntries.push(entry);
		entriesByTextureRef.set(entry.textureRefId, pageEntries);
	}

	return Array.from(entriesByTextureRef.entries())
		.map(([, pageEntries], pageIndex) => {
			const firstEntry = pageEntries[0];
			if (!firstEntry) {
				throw new Error("Texture diagnostics page has no registry entries.");
			}

			return {
				approximateBytes: estimateTextureBytes(
					firstEntry.textureWidth,
					firstEntry.textureHeight,
					firstEntry.format,
					firstEntry.mipmapsGenerated,
				),
				mipmapsGenerated: firstEntry.mipmapsGenerated,
				pageId: `page-${pageIndex + 1}`,
				sampleClass: firstEntry.sampleClass,
				uniqueSourceCount: countUniqueSources(pageEntries),
				wrapS: firstEntry.wrapS,
				wrapT: firstEntry.wrapT,
			};
		})
		.sort((left, right) => left.pageId.localeCompare(right.pageId));
}

function createTextureAtlasDomainDiagnostics(
	batches: readonly TextureAtlasBatchFacts[],
): TextureAtlasDiagnosticsReport["byDomain"] {
	const batchesByDomain = new Map<StaticDomain, TextureAtlasBatchFacts[]>();
	for (const batch of batches) {
		const domainBatches = batchesByDomain.get(batch.domain) ?? [];
		domainBatches.push(batch);
		batchesByDomain.set(batch.domain, domainBatches);
	}

	return Array.from(batchesByDomain.entries())
		.map(([domain, domainBatches]) => {
			const pages = domainBatches.flatMap((batch) => batch.pages);
			const activeBatchCount = domainBatches.filter(
				(batch) => batch.texturePageCount > 0,
			).length;

			return {
				activeBatchCount,
				approximateBytes: sumNumbers(
					pages.map((page) => page.approximateBytes),
				),
				batchCount: domainBatches.length,
				domain,
				emptyBatchCount: domainBatches.length - activeBatchCount,
				entryAliasCount: sumNumbers(
					domainBatches.map((batch) => batch.entryAliasCount),
				),
				mipmappedPageCount: pages.filter((page) => page.mipmapsGenerated)
					.length,
				multiSourcePageCount: sumNumbers(
					domainBatches.map((batch) => batch.multiSourcePageCount),
				),
				sampleClasses: countSampleClasses(pages),
				texturePageCount: pages.length,
				uniqueSourceCount: countUniqueDomainSources(domainBatches),
				unmippedPageCount: pages.filter((page) => !page.mipmapsGenerated)
					.length,
				wrapModes: countWrapModes(pages),
			};
		})
		.sort((left, right) => left.domain.localeCompare(right.domain));
}

function createTextureAtlasWarnings(
	recentRolePageOverflows: readonly TerrainRolePageOverflowDiagnostics[],
): TextureAtlasDiagnosticsReport["warnings"] {
	if (recentRolePageOverflows.length === 0) {
		return [];
	}

	const latest = recentRolePageOverflows.at(-1);
	return [
		{
			count: recentRolePageOverflows.length,
			kind: "terrain-role-page-overflow",
			latestDrawUnitId: latest?.drawUnitId ?? null,
			latestRole: latest?.kind ?? null,
		},
	];
}

function countSampleClasses(
	pages: readonly TextureAtlasPageFacts[],
): TextureAtlasDiagnosticsReport["byDomain"][number]["sampleClasses"] {
	return {
		index8: pages.filter((page) => page.sampleClass === "index8").length,
		index16: pages.filter((page) => page.sampleClass === "index16").length,
		"palette-rgba": pages.filter(
			(page) => page.sampleClass === "palette-rgba",
		).length,
		"rgba-color": pages.filter((page) => page.sampleClass === "rgba-color")
			.length,
		"rgba-detail": pages.filter((page) => page.sampleClass === "rgba-detail")
			.length,
		"rgba-exact": pages.filter((page) => page.sampleClass === "rgba-exact")
			.length,
		"rgba-mask": pages.filter((page) => page.sampleClass === "rgba-mask")
			.length,
	};
}

function countWrapModes(
	pages: readonly TextureAtlasPageFacts[],
): TextureAtlasDiagnosticsReport["byDomain"][number]["wrapModes"] {
	return {
		"clamp-to-edge": pages.filter(
			(page) => page.wrapS === "clamp-to-edge" && page.wrapT === "clamp-to-edge",
		).length,
		repeat: pages.filter(
			(page) => page.wrapS === "repeat" && page.wrapT === "repeat",
		).length,
	};
}

function countUniqueDomainSources(
	batches: readonly TextureAtlasBatchFacts[],
): number {
	return sumNumbers(batches.map((batch) => batch.uniqueSourceCount));
}

function countUniqueSources(
	entries: readonly StaticBatchTextureRegistryEntry[],
): number {
	const sources = new Set(
		entries.map((entry) => createMaterialTextureDataUseKey(entry.source)),
	);

	return sources.size;
}

function estimateTextureBytes(
	width: number,
	height: number,
	format: RuntimeTexturePlacement["format"],
	includeMipmaps: boolean,
): number {
	let bytes = width * height * getTextureFormatBytesPerPixel(format);
	if (!includeMipmaps) {
		return bytes;
	}

	let mipWidth = width;
	let mipHeight = height;
	while (mipWidth > 1 || mipHeight > 1) {
		mipWidth = Math.max(1, Math.floor(mipWidth / 2));
		mipHeight = Math.max(1, Math.floor(mipHeight / 2));
		bytes += mipWidth * mipHeight * getTextureFormatBytesPerPixel(format);
	}

	return bytes;
}

function getTextureFormatBytesPerPixel(
	format: RuntimeTexturePlacement["format"],
): number {
	switch (format) {
		case "r8ui":
			return 1;
		case "r16ui":
			return 2;
		case "rgba8":
			return 4;
	}
}

function sumNumbers(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

function appendBounded<T>(values: readonly T[], value: T, limit: number): T[] {
	return [...values, value].slice(-limit);
}

function createTerrainTextureRolePageKind(
	usage: MaterialTextureDataUseIdentity["usage"],
): TerrainTextureRolePageKind {
	if (usage === "rgba-mask") {
		return "mask";
	}
	if (usage === "rgba-detail") {
		return "detail";
	}

	return "color";
}

function resolveTextureRolePageSlot(options: {
	readonly domain: StaticDomain;
	readonly drawUnitId: string;
	readonly rolePageSlots: TerrainDrawUnitRolePageSlots;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureRefId: string;
}): TextureDrawUnitBinding["rolePage"] | null {
	if (options.domain === "outdoor-terrain") {
		return options.rolePageSlots.resolveSlot({
			drawUnitId: options.drawUnitId,
			textureRefId: options.textureRefId,
			usage: options.source.usage,
		});
	}

	if (options.source.kind === "palette-texture-use") {
		return { kind: "static-palette", slot: 0 };
	}

	if (options.source.usage === "index8" || options.source.usage === "index16") {
		return { kind: "static-index", slot: 0 };
	}

	return { kind: "static-base-color", slot: 0 };
}

class TerrainDrawUnitRolePageSlots {
	readonly #slotKeysByDrawUnitAndKind = new Map<string, string[]>();
	readonly #overflowKeys = new Set<string>();
	readonly #recordOverflow: (
		overflow: TerrainRolePageOverflowDiagnostics,
	) => void;

	constructor(
		recordOverflow: (overflow: TerrainRolePageOverflowDiagnostics) => void,
	) {
		this.#recordOverflow = recordOverflow;
	}

	resolveSlot(
		input: TerrainRolePageSlotInput,
	): TextureDrawUnitBinding["rolePage"] | null {
		const kind = createTerrainTextureRolePageKind(input.usage);
		const drawUnitKindKey = `${input.drawUnitId}:${kind}`;
		if (this.#overflowKeys.has(drawUnitKindKey)) {
			return null;
		}

		const slots = this.#slotKeysByDrawUnitAndKind.get(drawUnitKindKey) ?? [];
		const existingSlot = slots.indexOf(input.textureRefId);
		if (existingSlot >= 0) {
			return { kind, slot: existingSlot };
		}

		const maxSlots = getMaxTerrainRolePageSlots(kind);
		if (slots.length >= maxSlots) {
			this.#overflowKeys.add(drawUnitKindKey);
			this.#recordOverflow({
				drawUnitId: input.drawUnitId,
				kind,
				maxSlots,
				textureRefId: input.textureRefId,
			});
			console.warn(
				`V2 terrain draw unit ${input.drawUnitId} exceeded ${kind} role-page capacity ${maxSlots}; bindings for that role are omitted for local fallback.`,
				{
					kind,
					maxSlots,
					textureRefId: input.textureRefId,
				},
			);
			return null;
		}

		slots.push(input.textureRefId);
		this.#slotKeysByDrawUnitAndKind.set(drawUnitKindKey, slots);

		return { kind, slot: slots.length - 1 };
	}
}

function getMaxTerrainRolePageSlots(kind: TerrainTextureRolePageKind): number {
	if (kind === "color") {
		return MAX_TERRAIN_COLOR_PAGES_PER_DRAW;
	}
	if (kind === "mask") {
		return MAX_TERRAIN_MASK_PAGES_PER_DRAW;
	}

	return 1;
}
