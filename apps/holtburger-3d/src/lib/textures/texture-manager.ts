import type { AssetService } from "../assets/contracts";
import { createHostAssetKey } from "../assets/keys";
import {
	createPreparedTextureHostKey,
	prepareDirectPaletteTextureSource,
	prepareDirectMaterialTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type { DirectMaterialTextureSource } from "../assets/preparation/prepared-texture-source";
import type { TextureAtlasDiagnosticsReport } from "../runtime/diagnostics";
import type {
	SamplerPolicyUpdate,
	ObjectMaterialTextureRolePageKind,
	TerrainTextureRolePageKind,
	TextureBinding,
	TextureBindingOwner,
	TexturePlacementUpdate,
	ResolvedTexturePlacement,
} from "../renderer/types";
import {
	createTextureBindingOwnerKey,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../renderer/types";
import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
	VisualTextureDomain,
	StaticTextureUseOwner,
} from "../static/contracts";
import {
	collectStaticDrawUnitResourceIds,
	collectStaticObjectVisualResourceIds,
} from "../static/contracts";
import { AtlasTexturePacker, type TexturePacker } from "./packing/packer";
import type {
	TexturePackingJob,
	TexturePackingPageFormat,
	TexturePackingPixelSource,
	TexturePackingResult,
} from "./packing/protocol";
import {
	createRuntimeTexturePagePolicy,
	createRuntimeTextureSamplerPolicy,
	type TextureFilteringMode,
	type RuntimeTexturePagePolicy,
	type RuntimeTextureSamplerPolicy,
} from "./sampling-policy";
import {
	classifyTexturePlacementPool,
	classifyTextureUsagePurpose,
	createTexturePlacementBucketKey,
	createTexturePlacementItemId,
	type ObjectVisualTexturePlacementIntent,
	type ObjectVisualTexturePlacementSnapshot,
	type TexturePlacement as PlannedTexturePlacement,
	type TexturePlacementBucketKey,
	type TexturePlacementLookupId,
	type TexturePlacementIntent,
	type TexturePlacementPool,
	type TextureResourceDependencies,
	type TexturePlacementSnapshot,
	type TextureUsagePurpose,
} from "./placement";

const FILTERABLE_ATLAS_GUTTER_PIXELS = 4;
const EXACT_ATLAS_GUTTER_PIXELS = 0;
const TERRAIN_COLOR_ATLAS_GUTTER_PIXELS = 96;
const TERRAIN_MASK_ATLAS_GUTTER_PIXELS = 16;
const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;
const TERRAIN_COLOR_ATLAS_FILL_RGBA = [128, 128, 128, 255] as const;
const DEFAULT_TEXTURE_PACK_GROUP_MAX_CONCURRENCY = 8;

interface TextureManagerOptions {
	readonly assetService: AssetService;
	readonly filteringMode?: TextureFilteringMode;
	readonly packGroupMaxConcurrency?: number;
	readonly texturePacker?: TexturePacker;
}

export interface DynamicTextureUseCommit {
	readonly textureDomain: VisualTextureDomain;
	readonly placementBucketKey: TexturePlacementBucketKey;
	readonly owner: TextureBindingOwner & {
		readonly kind: "dynamic-visual-resource";
	};
	readonly samplingPolicy?: StaticBakeTextureUse["samplingPolicy"];
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureUseId: string;
}

export interface DynamicTextureUseCommitDelta {
	readonly removedOwners: readonly DynamicTextureUseCommit["owner"][];
	readonly textureUses: readonly DynamicTextureUseCommit[];
}

export interface TexturePlacementReferenceSnapshot {
	readonly activeReferenceCount: number;
	readonly freeable: boolean;
	readonly itemId: string;
	readonly pageId: string;
	readonly pool: TexturePlacementPool;
	readonly purpose: TextureUsagePurpose;
	readonly rect: readonly [number, number, number, number];
}

export class TextureManager {
	readonly #assetService: AssetService;
	readonly #texturePacker: TexturePacker;
	readonly #packGroupMaxConcurrency: number;
	readonly #placementBucketRegistries = new Map<
		VisualTexturePlacementBucketRegistryKey,
		VisualTexturePlacementBucketRegistry
	>();
	readonly #textureKeysByOwnerKey = new Map<string, Set<VisualTextureKey>>();
	readonly #placementRecordsByItemId = new Map<
		string,
		TexturePlacementRecord
	>();
	readonly #dependencyItemIdsByResourceId = new Map<string, Set<string>>();
	#filteringMode: TextureFilteringMode;
	#mutationQueue: Promise<void> = Promise.resolve();
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

		for (const registry of this.#placementBucketRegistries.values()) {
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
		const buckets = Array.from(this.#placementBucketRegistries.values())
			.sort((left, right) =>
				[left.domain, left.placementBucketKey]
					.join("|")
					.localeCompare([right.domain, right.placementBucketKey].join("|")),
			)
			.map((registry, index) =>
				createTextureAtlasBucketDiagnostics(registry, index),
			);
		const textureRefs = new Map<string, TextureAtlasPageFacts>();
		for (const bucket of buckets) {
			for (const page of bucket.pages) {
				textureRefs.set(`${bucket.bucketId}:${page.pageId}`, page);
			}
		}
		const pages = buckets.flatMap((bucket) => bucket.pages);
		const activeBucketCount = buckets.filter(
			(bucket) => bucket.texturePageCount > 0,
		).length;

		return {
			buckets,
			kind: "texture-atlas",
			summary: {
				approximateBytes: sumNumbers(
					Array.from(textureRefs.values(), (page) => page.approximateBytes),
				),
				activeBucketCount,
				bucketCount: buckets.length,
				emptyBucketCount: buckets.length - activeBucketCount,
				entryAliasCount: sumNumbers(
					buckets.map((bucket) => bucket.entryAliasCount),
				),
				mipmappedPageCount: pages.filter((page) => page.mipmapsGenerated)
					.length,
				multiSourcePageCount: sumNumbers(
					buckets.map((bucket) => bucket.multiSourcePageCount),
				),
				texturePageCount: textureRefs.size,
				unmippedPageCount: pages.filter((page) => !page.mipmapsGenerated)
					.length,
			},
		};
	}

	async placeTextureIntents<
		TPlacementItemId extends TexturePlacementLookupId,
	>(input: {
		readonly intents: readonly TexturePlacementIntent<TPlacementItemId>[];
	}): Promise<TexturePlacementSnapshot<TPlacementItemId>> {
		return this.#runTextureMutation(async () => {
			const pendingPlacements = new Map<string, PendingTexturePlacement>();
			const stagedPlacements: StagedTexturePlacement[] = [];
			const textureUses = input.intents.map((intent) =>
				createVisualTextureUseCommitFromIntent(intent),
			);

			for (const textureUse of textureUses) {
				stagedPlacements.push(
					await this.#stageTexturePlacement(textureUse, pendingPlacements),
				);
			}

			await this.#packPendingTexturePlacements(
				uniquePendingTexturePlacements(pendingPlacements),
				{
					reclaimZeroReferencePages: false,
					retainedTextureRefIds: collectStagedTextureRefIds(stagedPlacements),
				},
			);

			const placementsByItemId = new Map<
				TPlacementItemId,
				PlannedTexturePlacement<TPlacementItemId>
			>();
			for (let index = 0; index < textureUses.length; index += 1) {
				const textureUse = textureUses[index];
				const intent = input.intents[index];
				if (!textureUse || !intent) {
					throw new Error(
						"Texture placement intent commit lost item ordering.",
					);
				}
				const textureKey = createVisualTextureKey(textureUse);
				const entry =
					this.#getRegistry(
						textureUse.domain,
						textureUse.placementBucketKey,
					).entries.get(textureKey) ?? pendingPlacements.get(textureKey)?.entry;
				if (!entry) {
					throw new Error(
						`Texture placement ${textureUse.textureUseId} was not committed after packing.`,
					);
				}
				placementsByItemId.set(
					intent.itemId,
					toPlannedTexturePlacement(
						entry,
						intent.itemId,
						textureUse.textureUseId,
					),
				);
			}

			return { placementsByItemId };
		});
	}

	async placeObjectVisualTextureIntents(input: {
		readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	}): Promise<ObjectVisualTexturePlacementSnapshot> {
		const rebasedIntents = input.intents.map((intent, index) => ({
			...intent,
			itemId: createTexturePlacementItemId(index),
		}));
		const snapshot = await this.placeTextureIntents({
			intents: rebasedIntents,
		});
		return {
			...snapshot,
			itemIdsByTextureUseId: new Map(
				rebasedIntents.map((intent) => [intent.textureUseId, intent.itemId]),
			),
		};
	}

	pinTextureResourceDependencies(
		dependencies: readonly TextureResourceDependencies[],
	): void {
		for (const dependency of dependencies) {
			this.releaseTextureResourceDependencies([dependency.resourceId]);
			const itemIds = new Set(dependency.roles.flatMap((role) => role.itemIds));
			for (const itemId of itemIds) {
				this.#changePlacementActiveReferenceCount(itemId, 1);
			}
			this.#dependencyItemIdsByResourceId.set(dependency.resourceId, itemIds);
		}
	}

	releaseTextureResourceDependencies(resourceIds: readonly string[]): void {
		for (const resourceId of resourceIds) {
			const itemIds = this.#dependencyItemIdsByResourceId.get(resourceId);
			if (!itemIds) {
				continue;
			}
			this.#dependencyItemIdsByResourceId.delete(resourceId);
			for (const itemId of itemIds) {
				this.#changePlacementActiveReferenceCount(itemId, -1);
			}
		}
	}

	createPlacementReferenceSnapshot(): readonly TexturePlacementReferenceSnapshot[] {
		return Array.from(this.#placementRecordsByItemId.values())
			.map((record) => ({
				activeReferenceCount: record.activeReferenceCount,
				freeable: record.activeReferenceCount === 0,
				itemId: record.itemId,
				pageId: record.pageId,
				pool: record.pool,
				purpose: record.purpose,
				rect: record.rect,
			}))
			.sort((left, right) => left.itemId.localeCompare(right.itemId));
	}

	async applyStaticCommitDelta(
		delta: StaticCoordinatorCommitDelta,
	): Promise<TexturePlacementUpdate | null> {
		return this.#runTextureMutation(() =>
			this.#applyVisualTextureUseDelta({
				removedOwners: [
					...collectStaticDrawUnitResourceIds(delta.removedResources).map(
						(drawUnitId): StaticTextureUseOwner => ({
							drawUnitId,
							kind: "draw-unit",
						}),
					),
					...collectStaticObjectVisualResourceIds(delta.removedResources).map(
						(resourceId): StaticTextureUseOwner => ({
							kind: "static-object-visual-resource",
							resourceId,
						}),
					),
				],
				textureUses: delta.textureUses.map(createStaticVisualTextureUseCommit),
			}),
		);
	}

	async applyDynamicTextureUseDelta(
		delta: DynamicTextureUseCommitDelta,
	): Promise<TexturePlacementUpdate | null> {
		return this.#runTextureMutation(() =>
			this.#applyVisualTextureUseDelta({
				removedOwners: delta.removedOwners,
				textureUses: delta.textureUses.map(createDynamicVisualTextureUseCommit),
			}),
		);
	}

	async #applyVisualTextureUseDelta(
		delta: VisualTextureUseCommitDelta,
	): Promise<TexturePlacementUpdate | null> {
		const removedTextureRefIds = this.#removeOwnerTextureRefs(
			delta.removedOwners,
		);
		const placements: RuntimeTexturePlacement[] = [];
		const textureBindings: TextureBinding[] = [];
		const resolvedTexturePlacements: ResolvedTexturePlacement[] = [];
		const terrainRolePageSlots = new TerrainDrawUnitRolePageSlots();
		const objectMaterialRolePageSlots = new ObjectMaterialOwnerRolePageSlots();
		const pendingPlacements = new Map<string, PendingTexturePlacement>();
		const uploadedTextureRefIds = new Set<string>();

		for (const textureUse of delta.textureUses) {
			const staged = await this.#stageTexturePlacement(
				textureUse,
				pendingPlacements,
			);
			for (const owner of textureUse.owners) {
				const ownerKey = createTextureBindingOwnerKey(owner);
				let textureKeys = this.#textureKeysByOwnerKey.get(ownerKey);
				if (!textureKeys) {
					textureKeys = new Set<VisualTextureKey>();
					this.#textureKeysByOwnerKey.set(ownerKey, textureKeys);
				}
				if (!textureKeys.has(staged.textureKey)) {
					textureKeys.add(staged.textureKey);
					if (staged.entry) {
						if (
							staged.entry.leaseCount === 0 &&
							!this.#hasLeasedTextureRef(staged.entry.textureRefId) &&
							!uploadedTextureRefIds.has(staged.entry.textureRefId)
						) {
							placements.push(staged.entry.runtimePlacement);
							uploadedTextureRefIds.add(staged.entry.textureRefId);
						}
						staged.entry.leaseCount += 1;
						this.#setPlacementActiveReferenceCount(
							staged.entry,
							staged.entry.leaseCount,
						);
					} else {
						staged.pending.pendingLeaseCount += 1;
					}
				}
			}
		}

		const packedPlacements = await this.#packPendingTexturePlacements(
			uniquePendingTexturePlacements(pendingPlacements),
			{
				reclaimZeroReferencePages: false,
				retainedTextureRefIds: new Set(),
			},
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
			this.#setPlacementActiveReferenceCount(entry, entry.leaseCount);
		}

		for (const textureUse of delta.textureUses) {
			const textureKey = createVisualTextureKey(textureUse);
			const entry =
				this.#getRegistry(
					textureUse.domain,
					textureUse.placementBucketKey,
				).entries.get(textureKey) ?? pendingPlacements.get(textureKey)?.entry;
			if (!entry) {
				continue;
			}
			resolvedTexturePlacements.push({
				bindingKey: textureUse.textureUseId,
				rect: entry.rect,
				textureHeight: entry.textureHeight,
				textureRefId: entry.textureRefId,
				textureWidth: entry.textureWidth,
			});
			for (const owner of textureUse.owners) {
				const pageSlot = resolveTexturePageSlot({
					domain: textureUse.domain,
					owner,
					source: textureUse.source,
					objectMaterialRolePageSlots,
					terrainRolePageSlots,
					textureRefId: entry.textureRefId,
				});
				textureBindings.push({
					bindingKey: textureUse.textureUseId,
					owner,
					pageSlot,
					rect: entry.rect,
					textureHeight: entry.textureHeight,
					textureRefId: entry.textureRefId,
					textureWidth: entry.textureWidth,
				});
			}
		}

		if (
			placements.length === 0 &&
			removedTextureRefIds.length === 0 &&
			resolvedTexturePlacements.length === 0 &&
			textureBindings.length === 0
		) {
			return null;
		}

		this.#revision += 1;

		return {
			textureBindings,
			placements,
			removedTextureRefIds,
			resolvedTexturePlacements,
			revision: this.#revision,
		};
	}

	#runTextureMutation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#mutationQueue.then(operation, operation);
		this.#mutationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	#removeOwnerTextureRefs(
		removedOwners: readonly TextureBindingOwner[],
	): readonly string[] {
		const removedTextureRefIds: string[] = [];

		for (const owner of removedOwners) {
			const ownerKey = createTextureBindingOwnerKey(owner);
			const textureKeys = this.#textureKeysByOwnerKey.get(ownerKey);
			if (!textureKeys) {
				continue;
			}

			this.#textureKeysByOwnerKey.delete(ownerKey);
			for (const textureKey of textureKeys) {
				const entry = this.#findEntry(textureKey);
				if (!entry) {
					continue;
				}

				entry.leaseCount -= 1;
				this.#setPlacementActiveReferenceCount(
					entry,
					Math.max(entry.leaseCount, 0),
				);
				if (entry.leaseCount > 0) {
					continue;
				}

				const registry = this.#getRegistry(
					entry.domain,
					entry.placementBucketKey,
				);
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
		textureUse: VisualTextureUseCommit,
		pendingPlacements: Map<string, PendingTexturePlacement>,
	): Promise<StagedTexturePlacement> {
		const source = textureUse.source;
		const registry = this.#getRegistry(
			textureUse.domain,
			textureUse.placementBucketKey,
		);
		const textureKey = createVisualTextureKey(textureUse);
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
			textureUse.domain,
		);
		if (existingSourceEntry) {
			const registryEntry = createRegistryEntryAliasForPagePolicy(
				existingSourceEntry,
				pagePolicy,
				textureUse,
			);
			registry.entries.set(textureKey, registryEntry);
			this.#recordPlacementEntry(registryEntry);
			return {
				entry: registryEntry,
				textureKey,
			};
		}

		const placementKey = createVisualTextureSourcePlacementKey(textureUse);
		const pending = pendingPlacements.get(placementKey);
		if (pending) {
			addPendingPlacementOwners(pending, textureUse.owners);
			pending.textureKeys.add(textureKey);
			pending.textureUseIds.add(textureUse.textureUseId);
			pendingPlacements.set(textureKey, pending);
			return {
				entry: null,
				pending,
				textureKey,
			};
		}

		const directSource = await this.#prepareMaterialTextureSource(source);
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
			placementBucketKey: textureUse.placementBucketKey,
			textureKeys: new Set([textureKey]),
			textureUseIds: new Set([textureUse.textureUseId]),
			textureUse,
			ownerKeys: new Set(textureUse.owners.map(createTextureBindingOwnerKey)),
		};
		pendingPlacements.set(placementKey, staged);
		pendingPlacements.set(textureKey, staged);

		return {
			entry: null,
			pending: staged,
			textureKey,
		};
	}

	async #prepareMaterialTextureSource(
		source: MaterialTextureDataUseIdentity,
	): Promise<DirectMaterialTextureSource> {
		const prepared = await this.#assetService.requestPreparedAsset(
			createMaterialTextureHostKey(source),
		);
		if (source.kind !== "palette-texture-use") {
			return prepareDirectMaterialTextureSource(prepared, source);
		}

		const subPaletteAssets = await Promise.all(
			(source.subPalettes ?? []).map((subPalette) =>
				this.#assetService.requestPreparedAsset(
					createHostAssetKey("palette", subPalette.palette.paletteId),
				),
			),
		);
		return prepareDirectPaletteTextureSource(
			prepared,
			source,
			subPaletteAssets,
		);
	}

	async #packPendingTexturePlacements(
		pendingPlacements: readonly PendingTexturePlacement[],
		options: {
			readonly reclaimZeroReferencePages: boolean;
			readonly retainedTextureRefIds: ReadonlySet<string>;
		},
	): Promise<readonly RuntimeTexturePlacement[]> {
		const runtimePlacements: RuntimeTexturePlacement[] = [];
		if (options.reclaimZeroReferencePages) {
			this.#reclaimZeroReferencePagesForPendingPlacements(
				pendingPlacements,
				options.retainedTextureRefIds,
			);
		}
		const plannedGroups = this.#planPendingTexturePackingGroups(
			groupPendingTexturePlacements(pendingPlacements),
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

	#planPendingTexturePackingGroups(
		groups: readonly PendingTexturePlacementGroup[],
	): readonly PlannedPendingTexturePlacementGroup[] {
		const nextRevisionByRegistry = new Map<
			VisualTexturePlacementBucketRegistryKey,
			number
		>();

		return groups.map((group) => {
			const registryKey = createVisualTexturePlacementBucketRegistryKey(
				group.domain,
				group.placementBucketKey,
			);
			const currentRevision =
				nextRevisionByRegistry.get(registryKey) ??
				this.#getRegistry(group.domain, group.placementBucketKey).revision;
			const placementRevision = currentRevision + 1;
			nextRevisionByRegistry.set(registryKey, placementRevision);

			return {
				group,
				job: {
					cohorts: createTexturePackingCohorts(group),
					domain: group.domain,
					jobId: `texture-pack:${group.placementBucketKey}:${group.pageClassKey}:${placementRevision}`,
					page: createTexturePackingPageConstraints(group),
					placementRevision,
					sources: group.entries.map((entry) => ({
						gutterEdgeMode: createTexturePackingSourceGutterEdgeMode(
							entry.pagePolicy,
						),
						source: createTexturePackingPixelSource(entry.source),
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
			const physicalWrapMode = createPhysicalTexturePageWrapMode(group);
			const textureRefId =
				pageEntries.length === 1
					? createTextureRefId(
							group.domain,
							group.placementBucketKey,
							firstEntry.textureUse,
						)
					: createTexturePageRefId(
							group.domain,
							group.placementBucketKey,
							group.pageClassKey,
							placementRevision,
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
				wrapS: physicalWrapMode.wrapS,
				wrapT: physicalWrapMode.wrapT,
				width: page.width,
			});
			for (const entry of pageEntries) {
				const rect = rectByTextureUseId.get(entry.textureUse.textureUseId);
				if (!rect) {
					throw new Error(
						`Texture packing job for ${entry.textureUse.textureUseId} did not return a rect.`,
					);
				}
				const registryEntry: VisualTextureRegistryEntry = {
					anisotropy: group.samplerPolicy.anisotropy,
					domain: entry.domain,
					filteringMode: group.samplerPolicy.filteringMode,
					format: page.format,
					itemId: entry.textureUse.textureUseId,
					leaseCount: 0,
					mipmapsGenerated: group.samplerPolicy.generateMipmaps,
					pageId,
					placementRevision,
					pool: classifyTexturePlacementPool(entry.domain),
					purpose: classifyTextureUsagePurpose(
						entry.textureUse.source,
						classifyTexturePlacementPool(entry.domain),
					),
					rect: rect.rect,
					runtimePlacement: {
						...runtimePlacements[runtimePlacements.length - 1]!,
					},
					sampleClass: group.pagePolicy.sampleClass,
					samplerPolicyKey: group.samplerPolicy.policyKey,
					source: entry.textureUse.source,
					placementBucketKey: entry.placementBucketKey,
					textureHeight: page.height,
					textureRefId,
					textureWidth: page.width,
					wrapS: entry.pagePolicy.wrapS,
					wrapT: entry.pagePolicy.wrapT,
				};
				entry.entry = registryEntry;
				for (const textureKey of entry.textureKeys) {
					this.#getRegistry(entry.domain, entry.placementBucketKey).entries.set(
						textureKey,
						registryEntry,
					);
				}
				this.#recordPlacementEntry(registryEntry);
				for (const textureUseId of entry.textureUseIds) {
					this.#recordPlacementEntry(registryEntry, textureUseId);
				}
			}
		}

		const registry = this.#getRegistry(group.domain, group.placementBucketKey);
		registry.revision = Math.max(registry.revision, placementRevision);

		return runtimePlacements;
	}

	#hasTextureRef(textureRefId: string): boolean {
		for (const registry of this.#placementBucketRegistries.values()) {
			for (const entry of registry.entries.values()) {
				if (entry.textureRefId === textureRefId) {
					return true;
				}
			}
		}

		return false;
	}

	#getRegistry(
		domain: VisualTextureDomain,
		placementBucketKey: TexturePlacementBucketKey,
	): VisualTexturePlacementBucketRegistry {
		const registryKey = createVisualTexturePlacementBucketRegistryKey(
			domain,
			placementBucketKey,
		);
		let registry = this.#placementBucketRegistries.get(registryKey);
		if (!registry) {
			registry = {
				domain,
				entries: new Map<VisualTextureKey, VisualTextureRegistryEntry>(),
				revision: 0,
				placementBucketKey,
			};
			this.#placementBucketRegistries.set(registryKey, registry);
		}

		return registry;
	}

	#findEntry(textureKey: VisualTextureKey): VisualTextureRegistryEntry | null {
		for (const registry of this.#placementBucketRegistries.values()) {
			const entry = registry.entries.get(textureKey);
			if (entry) {
				return entry;
			}
		}

		return null;
	}

	#recordPlacementEntry(
		entry: VisualTextureRegistryEntry,
		itemId = entry.itemId,
	): void {
		this.#placementRecordsByItemId.set(itemId, {
			activeReferenceCount: entry.leaseCount,
			height: entry.textureHeight,
			itemId,
			pageId: entry.pageId,
			pool: entry.pool,
			purpose: entry.purpose,
			rect: entry.rect,
			textureRefId: entry.textureRefId,
			width: entry.textureWidth,
		});
	}

	#setPlacementActiveReferenceCount(
		entry: VisualTextureRegistryEntry,
		activeReferenceCount: number,
	): void {
		const record = this.#placementRecordsByItemId.get(entry.itemId);
		if (!record) {
			this.#recordPlacementEntry(entry);
			const createdRecord = this.#placementRecordsByItemId.get(entry.itemId);
			if (!createdRecord) {
				throw new Error(`Failed to record texture placement ${entry.itemId}.`);
			}
			createdRecord.activeReferenceCount = activeReferenceCount;
			return;
		}
		record.activeReferenceCount = activeReferenceCount;
	}

	#changePlacementActiveReferenceCount(itemId: string, delta: number): void {
		const record = this.#placementRecordsByItemId.get(itemId);
		if (!record) {
			throw new Error(`Cannot pin unknown texture placement item ${itemId}.`);
		}
		const nextCount = record.activeReferenceCount + delta;
		if (nextCount < 0) {
			throw new Error(
				`Texture placement item ${itemId} reference count cannot become ${nextCount}.`,
			);
		}
		record.activeReferenceCount = nextCount;
	}

	#reclaimZeroReferencePagesForPendingPlacements(
		pendingPlacements: readonly PendingTexturePlacement[],
		retainedTextureRefIds: ReadonlySet<string>,
	): void {
		if (pendingPlacements.length === 0) {
			return;
		}

		for (const textureRefId of this.#collectFullyFreeTextureRefIds(
			retainedTextureRefIds,
		)) {
			this.#deleteTextureRef(textureRefId);
		}
	}

	#collectFullyFreeTextureRefIds(
		retainedTextureRefIds: ReadonlySet<string>,
	): readonly string[] {
		const recordsByTextureRefId = new Map<string, TexturePlacementRecord[]>();
		for (const record of this.#placementRecordsByItemId.values()) {
			const records = recordsByTextureRefId.get(record.textureRefId) ?? [];
			records.push(record);
			recordsByTextureRefId.set(record.textureRefId, records);
		}

		const freeTextureRefIds: string[] = [];
		for (const [textureRefId, records] of recordsByTextureRefId) {
			if (retainedTextureRefIds.has(textureRefId)) {
				continue;
			}
			if (records.some((record) => record.activeReferenceCount > 0)) {
				continue;
			}
			if (this.#hasLeasedTextureRef(textureRefId)) {
				continue;
			}
			freeTextureRefIds.push(textureRefId);
		}
		return freeTextureRefIds.sort();
	}

	#hasLeasedTextureRef(textureRefId: string): boolean {
		for (const registry of this.#placementBucketRegistries.values()) {
			for (const entry of registry.entries.values()) {
				if (entry.textureRefId === textureRefId && entry.leaseCount > 0) {
					return true;
				}
			}
		}
		return false;
	}

	#deleteTextureRef(textureRefId: string): void {
		for (const registry of this.#placementBucketRegistries.values()) {
			for (const [textureKey, entry] of registry.entries) {
				if (entry.textureRefId === textureRefId) {
					registry.entries.delete(textureKey);
				}
			}
		}
		for (const [itemId, record] of this.#placementRecordsByItemId) {
			if (record.textureRefId === textureRefId) {
				this.#placementRecordsByItemId.delete(itemId);
			}
		}
	}
}

type RuntimeTexturePlacement = TexturePlacementUpdate["placements"][number];

interface VisualTextureUseCommit {
	readonly domain: VisualTextureDomain;
	readonly owners: readonly TextureBindingOwner[];
	readonly samplingPolicy?: StaticBakeTextureUse["samplingPolicy"];
	readonly source: MaterialTextureDataUseIdentity;
	readonly placementBucketKey: TexturePlacementBucketKey;
	readonly textureUseId: string;
}

interface VisualTextureUseCommitDelta {
	readonly removedOwners: readonly TextureBindingOwner[];
	readonly textureUses: readonly VisualTextureUseCommit[];
}

type VisualTexturePlacementBucketRegistryKey = string & {
	readonly __brand: "VisualTexturePlacementBucketRegistryKey";
};
type VisualTextureKey = string & {
	readonly __brand: "VisualTextureKey";
};

interface VisualTexturePlacementBucketRegistry {
	readonly domain: VisualTextureDomain;
	readonly placementBucketKey: TexturePlacementBucketKey;
	revision: number;
	readonly entries: Map<VisualTextureKey, VisualTextureRegistryEntry>;
}

interface VisualTextureRegistryEntry {
	anisotropy: number;
	readonly domain: VisualTextureDomain;
	filteringMode: TextureFilteringMode;
	readonly format: RuntimeTexturePlacement["format"];
	readonly itemId: string;
	readonly placementBucketKey: TexturePlacementBucketKey;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureRefId: string;
	readonly pageId: string;
	readonly placementRevision: number;
	readonly pool: TexturePlacementPool;
	readonly purpose: TextureUsagePurpose;
	mipmapsGenerated: boolean;
	readonly sampleClass: RuntimeTexturePagePolicy["sampleClass"];
	samplerPolicyKey: string;
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
	readonly runtimePlacement: RuntimeTexturePlacement;
	readonly wrapS: RuntimeTexturePagePolicy["wrapS"];
	readonly wrapT: RuntimeTexturePagePolicy["wrapT"];
	leaseCount: number;
}

interface TexturePlacementRecord {
	activeReferenceCount: number;
	readonly height: number;
	readonly itemId: string;
	readonly pageId: string;
	readonly pool: TexturePlacementPool;
	readonly purpose: TextureUsagePurpose;
	readonly rect: readonly [number, number, number, number];
	readonly textureRefId: string;
	readonly width: number;
}

interface TextureAtlasBucketFacts {
	readonly bucketId: string;
	readonly domain: VisualTextureDomain;
	readonly entryAliasCount: number;
	readonly placementBucketKey: string;
	readonly uniqueSourceCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly approximateBytes: number;
	readonly pages: readonly TextureAtlasPageFacts[];
	readonly wrapModes: Record<RuntimeTexturePagePolicy["wrapS"], number>;
}

interface TextureAtlasPageFacts {
	readonly pageId: string;
	readonly approximateBytes: number;
	readonly format: RuntimeTexturePlacement["format"];
	readonly height: number;
	readonly occupiedPixels: number;
	readonly packingEfficiency: number;
	readonly uniqueSourceCount: number;
	readonly width: number;
	readonly sampleClass: RuntimeTexturePagePolicy["sampleClass"];
	readonly mipmapsGenerated: boolean;
	readonly samplerPolicyKey: string;
	readonly wrapS: RuntimeTexturePagePolicy["wrapS"];
	readonly wrapT: RuntimeTexturePagePolicy["wrapT"];
}

type StagedTexturePlacement =
	| ExistingTexturePlacement
	| PendingStagedTexturePlacement;

interface ExistingTexturePlacement {
	readonly textureKey: VisualTextureKey;
	readonly entry: VisualTextureRegistryEntry;
}

interface PendingStagedTexturePlacement {
	readonly textureKey: VisualTextureKey;
	readonly entry: null;
	readonly pending: PendingTexturePlacement;
}

interface PendingTexturePlacement {
	readonly domain: VisualTextureDomain;
	readonly placementBucketKey: TexturePlacementBucketKey;
	readonly textureUse: VisualTextureUseCommit;
	readonly textureKeys: Set<VisualTextureKey>;
	/** Texture-use ids that share this staged source placement. */
	readonly textureUseIds: Set<string>;
	readonly source: DirectMaterialTextureSource;
	readonly pagePolicy: RuntimeTexturePagePolicy;
	readonly samplerPolicy: RuntimeTextureSamplerPolicy;
	readonly ownerKeys: Set<string>;
	entry: VisualTextureRegistryEntry | null;
	pendingLeaseCount: number;
}

interface PendingTexturePlacementGroup {
	readonly domain: VisualTextureDomain;
	readonly placementBucketKey: TexturePlacementBucketKey;
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

interface ObjectMaterialRolePageSlotInput {
	readonly ownerKey: string;
	readonly textureRefId: string;
	readonly source: MaterialTextureDataUseIdentity;
}

function createStaticVisualTextureUseCommit(
	textureUse: StaticBakeTextureUse,
): VisualTextureUseCommit {
	const pool = classifyTexturePlacementPool(textureUse.domain);
	const purpose = classifyTextureUsagePurpose(textureUse.source, pool);
	return {
		domain: textureUse.domain,
		owners: textureUse.owners,
		samplingPolicy: textureUse.samplingPolicy,
		source: textureUse.source,
		placementBucketKey: createTexturePlacementBucketKey({
			domain: textureUse.domain,
			lifetime: { kind: "static-authored" },
			purpose,
		}),
		textureUseId: textureUse.textureUseId,
	};
}

function createDynamicVisualTextureUseCommit(
	textureUse: DynamicTextureUseCommit,
): VisualTextureUseCommit {
	return {
		domain: textureUse.textureDomain,
		owners: [textureUse.owner],
		samplingPolicy: textureUse.samplingPolicy,
		source: textureUse.source,
		placementBucketKey: textureUse.placementBucketKey,
		textureUseId: textureUse.textureUseId,
	};
}

function createVisualTextureUseCommitFromIntent(
	intent: TexturePlacementIntent<TexturePlacementLookupId>,
): VisualTextureUseCommit {
	return {
		domain: intent.domain,
		owners: [],
		samplingPolicy: intent.source.samplingPolicy,
		source: intent.source.dataUse,
		placementBucketKey: intent.placementBucketKey,
		textureUseId: intent.textureUseId,
	};
}

function toPlannedTexturePlacement<
	TPlacementItemId extends TexturePlacementLookupId,
>(
	entry: VisualTextureRegistryEntry,
	itemId: TPlacementItemId,
	textureUseId: string,
): PlannedTexturePlacement<TPlacementItemId> {
	return {
		height: entry.textureHeight,
		itemId,
		pageId: entry.pageId,
		pool: entry.pool,
		purpose: entry.purpose,
		rect: entry.rect,
		textureRefId: entry.textureRefId,
		textureUseId,
		width: entry.textureWidth,
	};
}

function createVisualTexturePlacementBucketRegistryKey(
	domain: VisualTextureDomain,
	placementBucketKey: TexturePlacementBucketKey,
): VisualTexturePlacementBucketRegistryKey {
	return [domain, placementBucketKey].join(
		":",
	) as VisualTexturePlacementBucketRegistryKey;
}

function findRegistryEntryBySource(
	registry: VisualTexturePlacementBucketRegistry,
	source: MaterialTextureDataUseIdentity,
	pagePolicy: RuntimeTexturePagePolicy,
	domain: VisualTextureDomain,
): VisualTextureRegistryEntry | null {
	for (const entry of registry.entries.values()) {
		if (
			isSameMaterialTextureDataUse(entry.source, source) &&
			entry.sampleClass === pagePolicy.sampleClass &&
			(usesShaderVirtualWrap(domain, pagePolicy) ||
				(entry.wrapS === pagePolicy.wrapS && entry.wrapT === pagePolicy.wrapT))
		) {
			return entry;
		}
	}

	return null;
}

function createRegistryEntryAliasForPagePolicy(
	entry: VisualTextureRegistryEntry,
	pagePolicy: RuntimeTexturePagePolicy,
	textureUse: VisualTextureUseCommit,
): VisualTextureRegistryEntry {
	const pool = classifyTexturePlacementPool(textureUse.domain);
	if (entry.wrapS === pagePolicy.wrapS && entry.wrapT === pagePolicy.wrapT) {
		return {
			...entry,
			itemId: textureUse.textureUseId,
			leaseCount: 0,
			pool,
			purpose: classifyTextureUsagePurpose(textureUse.source, pool),
			source: textureUse.source,
		};
	}

	return {
		...entry,
		itemId: textureUse.textureUseId,
		leaseCount: 0,
		pool,
		purpose: classifyTextureUsagePurpose(textureUse.source, pool),
		source: textureUse.source,
		wrapS: pagePolicy.wrapS,
		wrapT: pagePolicy.wrapT,
	};
}

function uniqueSortedRegistryEntries(
	registry: VisualTexturePlacementBucketRegistry,
): readonly VisualTextureRegistryEntry[] {
	return Array.from(new Set(registry.entries.values())).sort((left, right) =>
		left.textureRefId.localeCompare(right.textureRefId),
	);
}

function deleteRegistryEntryAliases(
	registry: VisualTexturePlacementBucketRegistry,
	entry: VisualTextureRegistryEntry,
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

	if (
		left.kind === "palette-texture-use" &&
		right.kind === "palette-texture-use"
	) {
		return (
			left.palette.paletteId === right.palette.paletteId &&
			left.firstIndex === right.firstIndex &&
			left.indexCount === right.indexCount &&
			isSamePaletteTextureSubPalettes(left.subPalettes, right.subPalettes)
		);
	}

	if (
		left.kind === "prepared-render-surface-texture-use" &&
		right.kind === "prepared-render-surface-texture-use"
	) {
		return (
			left.renderSurface.renderSurfaceId === right.renderSurface.renderSurfaceId
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

function createTexturePackingPixelSource(
	source: DirectMaterialTextureSource,
): TexturePackingPixelSource {
	if (source.kind === "direct-rgba-texture-source") {
		return {
			format: "rgba8",
			height: source.height,
			kind: "texture-packing-pixel-source",
			pixels: source.pixels,
			width: source.width,
		};
	}

	if (source.kind === "direct-index-texture-source") {
		return {
			format: source.usage === "index8" ? "r8" : "rg8",
			height: source.height,
			kind: "texture-packing-pixel-source",
			pixels: source.indices,
			width: source.width,
		};
	}

	return {
		format: "rgba8",
		height: source.height,
		kind: "texture-packing-pixel-source",
		pixels: source.pixels,
		width: source.width,
	};
}

function createMaterialTextureDataUseKey(
	source: MaterialTextureDataUseIdentity,
): string {
	if (source.kind === "palette-texture-use") {
		return [
			source.kind,
			source.palette.paletteId.toString(16).padStart(8, "0"),
			`range:${source.firstIndex}-${source.indexCount}`,
			createPaletteTextureSubPalettesKey(source.subPalettes),
			source.usage,
		].join(":");
	}

	return [
		source.kind,
		source.renderSurface.renderSurfaceId.toString(16).padStart(8, "0"),
		source.usage,
	].join(":");
}

function isSamePaletteTextureSubPalettes(
	left:
		| Extract<
				MaterialTextureDataUseIdentity,
				{ readonly kind: "palette-texture-use" }
		  >["subPalettes"]
		| undefined,
	right:
		| Extract<
				MaterialTextureDataUseIdentity,
				{ readonly kind: "palette-texture-use" }
		  >["subPalettes"]
		| undefined,
): boolean {
	const leftSubPalettes = left ?? [];
	const rightSubPalettes = right ?? [];
	if (leftSubPalettes.length !== rightSubPalettes.length) {
		return false;
	}
	return leftSubPalettes.every((leftPalette, index) => {
		const rightPalette = rightSubPalettes[index];
		return (
			rightPalette !== undefined &&
			leftPalette.palette.paletteId === rightPalette.palette.paletteId &&
			leftPalette.firstIndex === rightPalette.firstIndex &&
			leftPalette.indexCount === rightPalette.indexCount
		);
	});
}

function createPaletteTextureSubPalettesKey(
	subPalettes:
		| Extract<
				MaterialTextureDataUseIdentity,
				{ readonly kind: "palette-texture-use" }
		  >["subPalettes"]
		| undefined,
): string {
	if (!subPalettes || subPalettes.length === 0) {
		return "sub:none";
	}
	return [
		"sub",
		...subPalettes.map(
			(subPalette) =>
				`${subPalette.palette.paletteId.toString(16).padStart(8, "0")}@${subPalette.firstIndex}+${subPalette.indexCount}`,
		),
	].join(":");
}

function createVisualTextureKey(
	textureUse: VisualTextureUseCommit,
): VisualTextureKey {
	return [
		textureUse.domain,
		textureUse.placementBucketKey,
		textureUse.textureUseId,
	].join(":") as VisualTextureKey;
}

function createVisualTextureSourcePlacementKey(
	textureUse: VisualTextureUseCommit,
): string {
	return [
		textureUse.domain,
		textureUse.placementBucketKey,
		createMaterialTextureDataUseKey(textureUse.source),
		createTextureUseSamplingKey(textureUse),
	].join(":");
}

function createTextureUseSamplingKey(
	textureUse: VisualTextureUseCommit,
): string {
	const samplingPolicy = textureUse.samplingPolicy;
	if (!samplingPolicy) {
		return "sampling:default";
	}

	return `sampling:wrap=${samplingPolicy.wrapS},${samplingPolicy.wrapT}`;
}

function createTextureRefId(
	domain: VisualTextureDomain,
	placementBucketKey: string,
	textureUse: Pick<VisualTextureUseCommit, "textureUseId">,
): string {
	return [
		"texture-ref",
		domain,
		placementBucketKey,
		textureUse.textureUseId,
	].join(":");
}

function createTexturePageRefId(
	domain: VisualTextureDomain,
	placementBucketKey: string,
	pageClassKey: string,
	placementRevision: number,
	pageId: string,
): string {
	return [
		"texture-page-ref",
		domain,
		placementBucketKey,
		pageClassKey,
		placementRevision.toString(),
		pageId,
	].join(":");
}

function groupPendingTexturePlacements(
	placements: readonly PendingTexturePlacement[],
): readonly PendingTexturePlacementGroup[] {
	const groups = new Map<string, PendingTexturePlacementGroup>();
	for (const placement of placements) {
		const pageClassKey = createTexturePageClassKey(
			placement.domain,
			placement.pagePolicy,
			placement.samplerPolicy,
		);
		const groupKey = `${placement.domain}|${placement.placementBucketKey}|${pageClassKey}`;
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
			placementBucketKey: placement.placementBucketKey,
		});
	}

	return [...groups.values()];
}

function uniquePendingTexturePlacements(
	placementsByKey: ReadonlyMap<string, PendingTexturePlacement>,
): readonly PendingTexturePlacement[] {
	return [...new Set(placementsByKey.values())];
}

function collectStagedTextureRefIds(
	stagedPlacements: readonly StagedTexturePlacement[],
): ReadonlySet<string> {
	return new Set(
		stagedPlacements.flatMap((placement) =>
			placement.entry ? [placement.entry.textureRefId] : [],
		),
	);
}

function addPendingPlacementOwners(
	placement: PendingTexturePlacement,
	owners: readonly TextureBindingOwner[],
): void {
	for (const owner of owners) {
		placement.ownerKeys.add(createTextureBindingOwnerKey(owner));
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
	if (shouldUseIndependentRolePagePacking(group)) {
		return undefined;
	}

	const textureUseIdsByOwnerKey = new Map<string, string[]>();
	for (const entry of group.entries) {
		for (const ownerKey of entry.ownerKeys) {
			const textureUseIds = textureUseIdsByOwnerKey.get(ownerKey) ?? [];
			textureUseIds.push(entry.textureUse.textureUseId);
			textureUseIdsByOwnerKey.set(ownerKey, textureUseIds);
		}
	}

	return [...textureUseIdsByOwnerKey.entries()]
		.map(([ownerKey, textureUseIds]) => ({
			key: `${group.pageClassKey}|${ownerKey}`,
			textureUseIds: uniqueSortedStrings(textureUseIds),
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function shouldUseIndependentRolePagePacking(
	group: PendingTexturePlacementGroup,
): boolean {
	return (
		(group.domain === "outdoor-terrain" &&
			(group.pagePolicy.sampleClass === "rgba-color" ||
				group.pagePolicy.sampleClass === "rgba-mask")) ||
		group.domain === "outdoor-buildings" ||
		group.domain === "outdoor-explicit-objects" ||
		group.domain === "outdoor-generated-scenery" ||
		group.domain === "env-cell-system" ||
		group.domain === "runtime-object-material"
	);
}

function createTexturePageClassKey(
	domain: VisualTextureDomain,
	pagePolicy: RuntimeTexturePagePolicy,
	samplerPolicy: RuntimeTextureSamplerPolicy,
): string {
	const keyParts = [
		`sample:${pagePolicy.sampleClass}`,
		`sampler:${samplerPolicy.policyKey}`,
	];
	if (!usesShaderVirtualWrap(domain, pagePolicy)) {
		keyParts.splice(1, 0, `wrap:${pagePolicy.wrapS},${pagePolicy.wrapT}`);
	}

	return keyParts.join("|");
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
		format: createTexturePackingPageFormat(pagePolicy.sampleClass),
		gutterEdgeMode: "clamp",
		gutterPixels,
		height: MAX_RUNTIME_ATLAS_PAGE_SIZE,
		pageSelection: "minimize-textures",
		width: MAX_RUNTIME_ATLAS_PAGE_SIZE,
	};
}

function createTexturePackingSourceGutterEdgeMode(
	pagePolicy: RuntimeTexturePagePolicy,
): TexturePackingJob["sources"][number]["gutterEdgeMode"] {
	return pagePolicy.wrapS === "repeat" && pagePolicy.wrapT === "repeat"
		? "repeat"
		: "clamp";
}

function createPhysicalTexturePageWrapMode(
	group: PendingTexturePlacementGroup,
): Pick<RuntimeTexturePagePolicy, "wrapS" | "wrapT"> {
	if (usesShaderVirtualWrap(group.domain, group.pagePolicy)) {
		return {
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		};
	}

	return {
		wrapS: group.pagePolicy.wrapS,
		wrapT: group.pagePolicy.wrapT,
	};
}

function usesShaderVirtualWrap(
	domain: VisualTextureDomain,
	pagePolicy: RuntimeTexturePagePolicy,
): boolean {
	return domain !== "outdoor-terrain" && pagePolicy.sampleClass !== "rgba-mask";
}

function createTexturePackingPageFormat(
	sampleClass: RuntimeTexturePagePolicy["sampleClass"],
): TexturePackingPageFormat {
	switch (sampleClass) {
		case "index8":
			return "r8";
		case "index16":
			return "rg8";
		case "palette-rgba":
		case "rgba-color":
		case "rgba-detail":
		case "rgba-exact":
		case "rgba-mask":
			return "rgba8";
		default: {
			const exhaustive: never = sampleClass;
			throw new Error(`Unsupported texture sample class ${exhaustive}.`);
		}
	}
}

function getRuntimeTexturePageGutterPixels(
	domain: VisualTextureDomain,
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

function createTextureAtlasBucketDiagnostics(
	registry: VisualTexturePlacementBucketRegistry,
	bucketIndex: number,
): TextureAtlasBucketFacts {
	const entries = Array.from(registry.entries.values());
	const pages = createTextureAtlasPageDiagnostics(entries);

	return {
		approximateBytes: sumNumbers(pages.map((page) => page.approximateBytes)),
		bucketId: `bucket-${bucketIndex + 1}`,
		domain: registry.domain,
		entryAliasCount: registry.entries.size,
		multiSourcePageCount: pages.filter((page) => page.uniqueSourceCount > 1)
			.length,
		pages,
		placementBucketKey: registry.placementBucketKey,
		texturePageCount: pages.length,
		uniqueSourceCount: countUniqueSources(entries),
		wrapModes: countWrapModesForEntries(entries),
	};
}

function createTextureAtlasPageDiagnostics(
	entries: readonly VisualTextureRegistryEntry[],
): readonly TextureAtlasPageFacts[] {
	const entriesByPageId = new Map<string, VisualTextureRegistryEntry[]>();
	for (const entry of entries) {
		const pageEntries = entriesByPageId.get(entry.pageId) ?? [];
		pageEntries.push(entry);
		entriesByPageId.set(entry.pageId, pageEntries);
	}

	return Array.from(entriesByPageId.entries())
		.sort(([left], [right]) => left.localeCompare(right))
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
				format: firstEntry.format,
				height: firstEntry.textureHeight,
				mipmapsGenerated: firstEntry.mipmapsGenerated,
				occupiedPixels: calculateTextureOccupiedPixels(pageEntries),
				pageId: `page-${pageIndex + 1}`,
				packingEfficiency: calculateTexturePackingEfficiency(pageEntries),
				sampleClass: firstEntry.sampleClass,
				samplerPolicyKey: firstEntry.samplerPolicyKey,
				uniqueSourceCount: countUniqueSources(pageEntries),
				width: firstEntry.textureWidth,
				wrapS: firstEntry.wrapS,
				wrapT: firstEntry.wrapT,
			};
		})
		.sort((left, right) => left.pageId.localeCompare(right.pageId));
}

function calculateTexturePackingEfficiency(
	entries: readonly VisualTextureRegistryEntry[],
): number {
	const firstEntry = entries[0];
	if (!firstEntry) {
		return 0;
	}
	const pagePixels = firstEntry.textureWidth * firstEntry.textureHeight;
	if (pagePixels <= 0) {
		return 0;
	}
	return calculateTextureOccupiedPixels(entries) / pagePixels;
}

function calculateTextureOccupiedPixels(
	entries: readonly VisualTextureRegistryEntry[],
): number {
	const firstEntry = entries[0];
	if (!firstEntry) {
		return 0;
	}
	return calculateRectUnionArea(
		uniqueSortedTextureEntries(entries).map((entry) =>
			clipTextureRect(entry.rect, {
				height: firstEntry.textureHeight,
				width: firstEntry.textureWidth,
			}),
		),
	);
}

function uniqueSortedTextureEntries(
	entries: readonly VisualTextureRegistryEntry[],
): readonly VisualTextureRegistryEntry[] {
	return Array.from(new Set(entries)).sort((left, right) =>
		[left.textureRefId, left.itemId]
			.join("|")
			.localeCompare([right.textureRefId, right.itemId].join("|")),
	);
}

function clipTextureRect(
	rect: readonly [number, number, number, number],
	page: { readonly width: number; readonly height: number },
): TextureOccupancyRect | null {
	const left = Math.max(0, rect[0]);
	const top = Math.max(0, rect[1]);
	const right = Math.min(page.width, rect[0] + rect[2]);
	const bottom = Math.min(page.height, rect[1] + rect[3]);
	if (right <= left || bottom <= top) {
		return null;
	}
	return { bottom, left, right, top };
}

function calculateRectUnionArea(
	rects: readonly (TextureOccupancyRect | null)[],
): number {
	const clippedRects = rects.filter(
		(rect): rect is TextureOccupancyRect => rect !== null,
	);
	if (clippedRects.length === 0) {
		return 0;
	}
	const xEdges = uniqueSortedNumbers(
		clippedRects.flatMap((rect) => [rect.left, rect.right]),
	);
	let area = 0;
	for (let index = 0; index < xEdges.length - 1; index += 1) {
		const left = xEdges[index]!;
		const right = xEdges[index + 1]!;
		if (right <= left) {
			continue;
		}
		const yIntervals = clippedRects
			.filter((rect) => rect.left < right && rect.right > left)
			.map((rect) => [rect.top, rect.bottom] as const)
			.sort(
				(leftInterval, rightInterval) => leftInterval[0] - rightInterval[0],
			);
		area += (right - left) * calculateIntervalUnionLength(yIntervals);
	}
	return area;
}

function calculateIntervalUnionLength(
	intervals: readonly (readonly [number, number])[],
): number {
	let total = 0;
	let activeStart: number | null = null;
	let activeEnd: number | null = null;
	for (const [start, end] of intervals) {
		if (activeStart === null || activeEnd === null) {
			activeStart = start;
			activeEnd = end;
			continue;
		}
		if (start > activeEnd) {
			total += activeEnd - activeStart;
			activeStart = start;
			activeEnd = end;
			continue;
		}
		activeEnd = Math.max(activeEnd, end);
	}
	if (activeStart !== null && activeEnd !== null) {
		total += activeEnd - activeStart;
	}
	return total;
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

interface TextureOccupancyRect {
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
}

function countWrapModesForEntries(
	entries: readonly VisualTextureRegistryEntry[],
): TextureAtlasBucketFacts["wrapModes"] {
	return {
		"clamp-to-edge": entries.filter(
			(entry) =>
				entry.wrapS === "clamp-to-edge" && entry.wrapT === "clamp-to-edge",
		).length,
		repeat: entries.filter(
			(entry) => entry.wrapS === "repeat" && entry.wrapT === "repeat",
		).length,
	};
}

function countUniqueSources(
	entries: readonly VisualTextureRegistryEntry[],
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
		case "r8":
			return 1;
		case "rg8":
			return 2;
		case "rgba8":
			return 4;
	}
}

function sumNumbers(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
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

function resolveTexturePageSlot(options: {
	readonly domain: VisualTextureDomain;
	readonly owner: TextureBindingOwner;
	readonly source: MaterialTextureDataUseIdentity;
	readonly objectMaterialRolePageSlots: ObjectMaterialOwnerRolePageSlots;
	readonly terrainRolePageSlots: TerrainDrawUnitRolePageSlots;
	readonly textureRefId: string;
}): TextureBinding["pageSlot"] {
	if (options.domain === "outdoor-terrain") {
		if (options.owner.kind !== "draw-unit") {
			throw new Error(
				`Terrain texture use cannot be owned by ${options.owner.kind}.`,
			);
		}
		return options.terrainRolePageSlots.resolveSlot({
			drawUnitId: options.owner.drawUnitId,
			textureRefId: options.textureRefId,
			usage: options.source.usage,
		});
	}

	const objectSlot = options.objectMaterialRolePageSlots.resolveSlot({
		ownerKey: createTextureBindingOwnerKey(options.owner),
		source: options.source,
		textureRefId: options.textureRefId,
	});
	if (objectSlot === null) {
		throw new Error(
			`Object material texture binding for ${createTextureBindingOwnerKey(options.owner)} exceeded one page for ${createObjectMaterialTextureRolePageKind(options.source)}.`,
		);
	}

	return objectSlot;
}

class TerrainDrawUnitRolePageSlots {
	readonly #slotKeysByDrawUnitAndKind = new Map<string, string[]>();

	resolveSlot(input: TerrainRolePageSlotInput): TextureBinding["pageSlot"] {
		const kind = createTerrainTextureRolePageKind(input.usage);
		const drawUnitKindKey = `${input.drawUnitId}:${kind}`;

		const slots = this.#slotKeysByDrawUnitAndKind.get(drawUnitKindKey) ?? [];
		const existingSlot = slots.indexOf(input.textureRefId);
		if (existingSlot >= 0) {
			return { kind, slot: existingSlot };
		}

		const maxSlots = getMaxTerrainRolePageSlots(kind);
		if (slots.length >= maxSlots) {
			throw new Error(
				`Terrain draw unit ${input.drawUnitId} exceeded ${kind} texture page capacity ${maxSlots}; baker must split illegal terrain draw units before commit.`,
			);
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

class ObjectMaterialOwnerRolePageSlots {
	readonly #textureRefByOwnerAndKind = new Map<string, string>();

	resolveSlot(
		input: ObjectMaterialRolePageSlotInput,
	): TextureBinding["pageSlot"] | null {
		const kind = createObjectMaterialTextureRolePageKind(input.source);
		const ownerKindKey = `${input.ownerKey}:${kind}`;
		const textureRefId = this.#textureRefByOwnerAndKind.get(ownerKindKey);
		if (textureRefId && textureRefId !== input.textureRefId) {
			return null;
		}

		this.#textureRefByOwnerAndKind.set(ownerKindKey, input.textureRefId);
		return { kind, slot: 0 };
	}
}

function createObjectMaterialTextureRolePageKind(
	source: MaterialTextureDataUseIdentity,
): ObjectMaterialTextureRolePageKind {
	if (source.kind === "palette-texture-use") {
		return "object-palette";
	}
	if (source.usage === "index8" || source.usage === "index16") {
		return "object-index";
	}
	if (source.usage === "rgba-detail") {
		return "object-detail";
	}

	return "object-base-color";
}
