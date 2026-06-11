import type { AssetService } from "../assets/contracts";
import {
	createPreparedTextureHostKey,
	prepareDirectRgbaTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type { TexturePlacementUpdate } from "../renderer/types";
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
const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;

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
	#revision = 0;

	constructor(options: TextureManagerOptions) {
		this.#assetService = options.assetService;
		this.#filteringMode = options.filteringMode ?? "anisotropic-4x";
		this.#texturePacker = options.texturePacker ?? new AtlasTexturePacker();
	}

	dispose(): void {
		this.#texturePacker.dispose?.();
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

				const entry = registry.entries.get(
					createStaticBatchTextureKey(
						firstPayload.job.domain,
						staticBatchId,
						textureUse,
					),
				);
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
		const drawUnitBindings = [];
		const pendingPlacements = new Map<
			StaticBatchTextureKey,
			PendingTexturePlacement
		>();

		for (const textureUse of delta.textureUses) {
			const placement = await this.#stageTexturePlacement(
				textureUse,
				pendingPlacements,
			);
			const entry = placement.entry ?? null;

			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				let textureKeys = this.#textureKeysByDrawUnitId.get(drawUnitId);
				if (!textureKeys) {
					textureKeys = new Set<StaticBatchTextureKey>();
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

		const packedPlacements = await this.#packPendingTexturePlacements([
			...pendingPlacements.values(),
		]);
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
			const textureKey = createStaticBatchTextureKey(
				textureUse.domain,
				textureUse.staticBatchId,
				textureUse.source,
			);
			const entry =
				this.#getRegistry(
					textureUse.domain,
					textureUse.staticBatchId,
				).entries.get(textureKey) ?? pendingPlacements.get(textureKey)?.entry;
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
		pendingPlacements: Map<StaticBatchTextureKey, PendingTexturePlacement>,
	): Promise<StagedTexturePlacement> {
		const registry = this.#getRegistry(
			textureUse.domain,
			textureUse.staticBatchId,
		);
		const textureKey = createStaticBatchTextureKey(
			textureUse.domain,
			textureUse.staticBatchId,
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
			staticBatchId: textureUse.staticBatchId,
			textureKey,
			textureUse,
		};
		pendingPlacements.set(textureKey, staged);

		return staged;
	}

	async #packPendingTexturePlacements(
		pendingPlacements: readonly PendingTexturePlacement[],
	): Promise<readonly RuntimeTexturePlacement[]> {
		const runtimePlacements: RuntimeTexturePlacement[] = [];
		for (const group of groupPendingTexturePlacements(pendingPlacements)) {
			const registry = this.#getRegistry(group.domain, group.staticBatchId);
			const placementRevision = registry.revision + 1;
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
				jobId: `texture-pack:${group.staticBatchId}:${group.pageClassKey}:${placementRevision}`,
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
						? createTextureRefId(
								group.domain,
								group.staticBatchId,
								firstEntry.textureUse.source,
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
						domain: entry.domain,
						leaseCount: 0,
						placementRevision,
						rect: rect.rect,
						source: entry.textureUse.source,
						staticBatchId: entry.staticBatchId,
						textureHeight: page.height,
						textureRefId,
						textureWidth: page.width,
					};
					this.#getRegistry(entry.domain, entry.staticBatchId).entries.set(
						entry.textureKey,
						entry.entry,
					);
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
	readonly domain: StaticDomain;
	readonly staticBatchId: string;
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
	readonly textureKey: StaticBatchTextureKey;
	readonly entry: StaticBatchTextureRegistryEntry;
	pendingLeaseCount: 0;
}

interface PendingTexturePlacement {
	readonly domain: StaticDomain;
	readonly staticBatchId: string;
	readonly textureUse: StaticBakeTextureUse;
	readonly textureKey: StaticBatchTextureKey;
	readonly source: ReturnType<typeof prepareDirectRgbaTextureSource>;
	readonly pagePolicy: RuntimeTexturePagePolicy;
	readonly samplerPolicy: RuntimeTextureSamplerPolicy;
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

function createStaticBatchTextureKey(
	domain: StaticDomain,
	staticBatchId: string,
	source: PreparedTextureUseIdentity,
): StaticBatchTextureKey {
	return [
		domain,
		staticBatchId,
		source.kind,
		source.renderSurfaceId.toString(16).padStart(8, "0"),
		source.usage,
		source.outputFormat,
	].join(":") as StaticBatchTextureKey;
}

function createTextureRefId(
	domain: StaticDomain,
	staticBatchId: string,
	source: PreparedTextureUseIdentity,
): string {
	return [
		"texture-ref",
		domain,
		staticBatchId,
		source.renderSurfaceId.toString(16).padStart(8, "0"),
		source.usage,
		source.outputFormat,
	].join(":");
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

	return {
		format: "rgba8",
		gutterPixels,
		height: MAX_RUNTIME_ATLAS_PAGE_SIZE,
		pageSelection: "minimize-textures",
		width: MAX_RUNTIME_ATLAS_PAGE_SIZE,
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
