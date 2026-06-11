import type { AssetService } from "../assets/contracts";
import {
	createPreparedTextureHostKey,
	prepareDirectRgbaTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type {
	TerrainRolePageOverflowDiagnostics,
	TerrainRolePageUsageDiagnostics,
	TextureAtlasBatchDiagnostics,
	TextureAtlasDiagnosticsReport,
	TextureAtlasPageDiagnostics,
} from "../runtime/diagnostics";
import type {
	TerrainTextureBinding,
	TerrainTextureRolePageKind,
	TexturePlacementUpdate,
} from "../renderer/types";
import {
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../renderer/types";
import type {
	StaticAtlasBatchSnapshot,
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
const TERRAIN_COLOR_ATLAS_GUTTER_PIXELS = 96;
const TERRAIN_MASK_ATLAS_GUTTER_PIXELS = 16;
const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;
const TERRAIN_COLOR_ATLAS_FILL_RGBA = [128, 128, 128, 255] as const;
const RECENT_TERRAIN_ROLE_PAGE_OVERFLOW_LIMIT = 16;
const TERRAIN_ROLE_PAGE_OUTLIER_LIMIT = 16;

interface TextureManagerOptions {
	readonly assetService: AssetService;
	readonly filteringMode?: TextureFilteringMode;
	readonly texturePacker?: TexturePacker;
}

export class TextureManager {
	readonly #assetService: AssetService;
	readonly #filteringMode: TextureFilteringMode;
	readonly #texturePacker: TexturePacker;
	readonly #batchRegistries = new Map<
		StaticBatchRegistryKey,
		StaticBatchTextureRegistry
	>();
	readonly #textureKeysByDrawUnitId = new Map<
		string,
		Set<StaticBatchTextureKey>
	>();
	#recentRolePageOverflows: TerrainRolePageOverflowDiagnostics[] = [];
	#revision = 0;

	constructor(options: TextureManagerOptions) {
		this.#assetService = options.assetService;
		this.#filteringMode = options.filteringMode ?? "anisotropic-4x";
		this.#texturePacker = options.texturePacker ?? new AtlasTexturePacker();
	}

	dispose(): void {
		this.#texturePacker.dispose?.();
	}

	createDiagnosticsReport(): TextureAtlasDiagnosticsReport {
		const batches = Array.from(this.#batchRegistries.values())
			.sort((left, right) =>
				[left.domain, left.staticBatchId].join("|").localeCompare(
					[right.domain, right.staticBatchId].join("|"),
				),
			)
			.map((registry, index) =>
				createTextureAtlasBatchDiagnostics(registry, index),
			);
		const textureRefs = new Map<string, TextureAtlasPageDiagnostics>();
		for (const batch of batches) {
			for (const page of batch.pages) {
				textureRefs.set(`${batch.batchId}:${page.pageId}`, page);
			}
		}

		return {
			batches,
			kind: "texture-atlas",
			recentRolePageOverflows: this.#recentRolePageOverflows,
			summary: {
				approximateBytes: sumNumbers(
					Array.from(textureRefs.values(), (page) => page.approximateBytes),
				),
				batchCount: batches.length,
				entryAliasCount: sumNumbers(
					batches.map((batch) => batch.entryAliasCount),
				),
				multiSourcePageCount: sumNumbers(
					batches.map((batch) => batch.multiSourcePageCount),
				),
				texturePageCount: textureRefs.size,
			},
			terrainRolePages: this.#createTerrainRolePageUsageDiagnostics(),
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
				if (textureUse.kind !== "prepared-texture-use") {
					return [];
				}

				const entry = findRegistryEntryBySource(registry, textureUse);
				return entry
					? [
							{
								texture: entry.source,
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
		const drawUnitBindings: TerrainTextureBinding[] = [];
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
				const rolePage = rolePageSlots.resolveSlot({
					drawUnitId,
					textureRefId: entry.textureRefId,
					usage: textureUse.source.usage,
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

		const existingSourceEntry = findRegistryEntryBySource(
			registry,
			textureUse.source,
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
		for (const group of groupPendingTexturePlacements(pendingPlacements)) {
			const registry = this.#getRegistry(group.domain, group.staticBatchId);
			const placementRevision = registry.revision + 1;
			const packed = await this.#texturePacker.pack({
				cohorts: createTexturePackingCohorts(group),
				domain: group.domain,
				jobId: `texture-pack:${group.staticBatchId}:${group.pageClassKey}:${placementRevision}`,
				page: createTexturePackingPageConstraints(group),
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
					for (const textureKey of entry.textureKeys) {
						this.#getRegistry(entry.domain, entry.staticBatchId).entries.set(
							textureKey,
							entry.entry,
						);
					}
				}
			}
			registry.revision = placementRevision;
		}

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

	#createTerrainRolePageUsageDiagnostics(): TerrainRolePageUsageDiagnostics {
		const usages = Array.from(this.#textureKeysByDrawUnitId.entries())
			.map(([drawUnitId, textureKeys]) => {
				const pagesByKind = {
					color: new Set<string>(),
					detail: new Set<string>(),
					mask: new Set<string>(),
				};
				for (const textureKey of textureKeys) {
					const entry = this.#findEntry(textureKey);
					if (!entry) {
						continue;
					}
					pagesByKind[createTerrainTextureRolePageKind(entry.source.usage)].add(
						entry.textureRefId,
					);
				}

				return {
					colorPages: pagesByKind.color.size,
					detailPages: pagesByKind.detail.size,
					drawUnitId,
					maskPages: pagesByKind.mask.size,
				};
			})
			.sort((left, right) => left.drawUnitId.localeCompare(right.drawUnitId));
		const outliers = usages.filter(
			(usage) =>
				usage.colorPages > 1 || usage.maskPages > 1 || usage.maskPages === 0,
		);

		return {
			drawUnitCount: usages.length,
			maxColorPages: maxNumbers(usages.map((usage) => usage.colorPages)),
			maxDetailPages: maxNumbers(usages.map((usage) => usage.detailPages)),
			maxMaskPages: maxNumbers(usages.map((usage) => usage.maskPages)),
			missingMaskDrawUnits: usages.filter((usage) => usage.maskPages === 0)
				.length,
			multiColorDrawUnits: usages.filter((usage) => usage.colorPages > 1).length,
			multiMaskDrawUnits: usages.filter((usage) => usage.maskPages > 1).length,
			outliers: outliers.slice(0, TERRAIN_ROLE_PAGE_OUTLIER_LIMIT),
		};
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
	readonly anisotropy: number;
	readonly domain: StaticDomain;
	readonly filteringMode: TextureFilteringMode;
	readonly format: RuntimeTexturePlacement["format"];
	readonly staticBatchId: string;
	readonly source: PreparedTextureUseIdentity;
	readonly textureRefId: string;
	readonly placementRevision: number;
	readonly mipmapsGenerated: boolean;
	readonly sampleClass: RuntimeTexturePagePolicy["sampleClass"];
	readonly samplerPolicyKey: string;
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
	readonly wrapS: RuntimeTexturePagePolicy["wrapS"];
	readonly wrapT: RuntimeTexturePagePolicy["wrapT"];
	leaseCount: number;
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
	readonly source: ReturnType<typeof prepareDirectRgbaTextureSource>;
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

interface TerrainRolePageSlotInput {
	readonly drawUnitId: string;
	readonly textureRefId: string;
	readonly usage: PreparedTextureUseIdentity["usage"];
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
	source: PreparedTextureUseIdentity,
): StaticBatchTextureRegistryEntry | null {
	for (const entry of registry.entries.values()) {
		if (isSamePreparedTextureUse(entry.source, source)) {
			return entry;
		}
	}

	return null;
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

function isSamePreparedTextureUse(
	left: PreparedTextureUseIdentity,
	right: PreparedTextureUseIdentity,
): boolean {
	return (
		left.kind === right.kind &&
		left.renderSurfaceId === right.renderSurfaceId &&
		left.usage === right.usage &&
		left.outputFormat === right.outputFormat
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
		createPreparedTextureUseKey(textureUse.source),
	].join(":");
}

function createPreparedTextureUseKey(source: PreparedTextureUseIdentity): string {
	return [
		source.kind,
		source.renderSurfaceId.toString(16).padStart(8, "0"),
		source.usage,
		source.outputFormat,
	].join(":");
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
): TextureAtlasBatchDiagnostics {
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
		revision: registry.revision,
		texturePageCount: pages.length,
		uniqueSourceCount: countUniqueSources(entries),
	};
}

function createTextureAtlasPageDiagnostics(
	entries: readonly StaticBatchTextureRegistryEntry[],
): readonly TextureAtlasPageDiagnostics[] {
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
				anisotropy: firstEntry.anisotropy,
				approximateBytes: estimateRgba8TextureBytes(
					firstEntry.textureWidth,
					firstEntry.textureHeight,
					firstEntry.mipmapsGenerated,
				),
				entryAliasCount: pageEntries.length,
				filteringMode: firstEntry.filteringMode,
				format: firstEntry.format,
				height: firstEntry.textureHeight,
				mipmapsGenerated: firstEntry.mipmapsGenerated,
				pageId: `page-${pageIndex + 1}`,
				sampleClass: firstEntry.sampleClass,
				samplerPolicyKey: firstEntry.samplerPolicyKey,
				totalLeaseCount: sumNumbers(
					uniqueRegistryEntries(pageEntries).map((entry) => entry.leaseCount),
				),
				uniqueSourceCount: countUniqueSources(pageEntries),
				width: firstEntry.textureWidth,
				wrapS: firstEntry.wrapS,
				wrapT: firstEntry.wrapT,
			};
		})
		.sort((left, right) => left.pageId.localeCompare(right.pageId));
}

function countUniqueSources(
	entries: readonly StaticBatchTextureRegistryEntry[],
): number {
	const sources = new Set(
		entries.map((entry) => createPreparedTextureUseKey(entry.source)),
	);

	return sources.size;
}

function uniqueRegistryEntries(
	entries: readonly StaticBatchTextureRegistryEntry[],
): readonly StaticBatchTextureRegistryEntry[] {
	return Array.from(new Set(entries));
}

function estimateRgba8TextureBytes(
	width: number,
	height: number,
	includeMipmaps: boolean,
): number {
	let bytes = width * height * 4;
	if (!includeMipmaps) {
		return bytes;
	}

	let mipWidth = width;
	let mipHeight = height;
	while (mipWidth > 1 || mipHeight > 1) {
		mipWidth = Math.max(1, Math.floor(mipWidth / 2));
		mipHeight = Math.max(1, Math.floor(mipHeight / 2));
		bytes += mipWidth * mipHeight * 4;
	}

	return bytes;
}

function sumNumbers(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

function maxNumbers(values: readonly number[]): number {
	return values.length === 0 ? 0 : Math.max(...values);
}

function appendBounded<T>(
	values: readonly T[],
	value: T,
	limit: number,
): T[] {
	return [...values, value].slice(-limit);
}

function createTerrainTextureRolePageKind(
	usage: PreparedTextureUseIdentity["usage"],
): TerrainTextureRolePageKind {
	if (usage === "mask") {
		return "mask";
	}
	if (usage === "detail") {
		return "detail";
	}

	return "color";
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
	): TerrainTextureBinding["rolePage"] | null {
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
