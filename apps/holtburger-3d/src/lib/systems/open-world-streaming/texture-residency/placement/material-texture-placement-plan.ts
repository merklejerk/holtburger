import { getRuntimeTexturePageGutterPixels } from "../../../../textures/material-texture-identity";
import type { TextureBindingId } from "../../../../textures/identity";
import type { TexturePackingPageFormat } from "../../../../textures/packing/protocol";
import type {
	TexturePlacement,
	TexturePlacementIntent,
	TexturePlacementLookupId,
} from "../../../../textures/placement";
import {
	createRuntimeTexturePagePolicy,
	createRuntimeTextureSamplerPolicy,
	type TextureFilteringMode,
} from "../../../../textures/sampling-policy";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldTextureBucketKey } from "../claims/bucket-key";
import {
	OpenWorldTextureClaimRegistry,
	type OpenWorldTextureBindingRequirement,
	type OpenWorldTextureBucketSnapshot,
	type OpenWorldTextureEntryId,
} from "../claims/texture-claim-registry";
import type { OpenWorldTexturePageBuildInput } from "../page-build/protocol";
import { createMaterialTexturePlacementBucketKey } from "./material-texture-placement-policy";
import type {
	OpenWorldMaterialTextureAtlasBuilder,
	OpenWorldObjectVisualAtlasPlacementRect,
} from "../atlas-build/object-visual-atlas-builder";

const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;

export interface OpenWorldMaterialTexturePlacementReservationOptions<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
> {
	readonly atlasBuilder: OpenWorldMaterialTextureAtlasBuilder;
	readonly filteringMode: TextureFilteringMode;
	readonly intents: readonly TIntent[];
	readonly jobPrefix: string;
	readonly ownerId: MaterializationOwnerId;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldMaterialTexturePlacementReservation<
	TItemId extends TexturePlacementLookupId,
> {
	/** Bake-facing placements produced before page pixels are materialized. */
	readonly bindingPlacements: readonly {
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}[];
	/** Immutable page-build work products; these may settle after bake work starts. */
	readonly pageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

export async function reserveMaterialTexturePlacements<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(
	options: OpenWorldMaterialTexturePlacementReservationOptions<
		TItemId,
		TIntent
	>,
): Promise<OpenWorldMaterialTexturePlacementReservation<TItemId>> {
	const intentsByBucket = groupMaterialTextureIntentsByBucket(options.intents);
	const bindingPlacements: Array<{
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}> = [];
	const pageBuildRequests: OpenWorldTexturePageBuildInput[] = [];
	const stageTimings: OpenWorldStreamingStaticTaskStageTiming[] = [];

	for (const [bucketKey, intents] of intentsByBucket) {
		const snapshot = options.textureClaims.retainTextureBindings(
			options.ownerId,
			bucketKey,
			intents.map((intent) => createBindingRequirement(bucketKey, intent)),
		);
		const bucketReservation = await reserveBucketTexturePlacements<
			TItemId,
			TIntent
		>({
			atlasBuilder: options.atlasBuilder,
			bucketKey,
			filteringMode: options.filteringMode,
			intents,
			jobPrefix: options.jobPrefix,
			snapshot,
			textureClaims: options.textureClaims,
		});
		bindingPlacements.push(...bucketReservation.bindingPlacements);
		pageBuildRequests.push(...bucketReservation.pageBuildRequests);
		stageTimings.push(...bucketReservation.stageTimings);
	}

	return {
		bindingPlacements,
		pageBuildRequests,
		stageTimings,
	};
}

function groupMaterialTextureIntentsByBucket<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(
	intents: readonly TIntent[],
): ReadonlyMap<OpenWorldTextureBucketKey, readonly TIntent[]> {
	const grouped = new Map<OpenWorldTextureBucketKey, TIntent[]>();
	for (const intent of intents) {
		const bucketKey = createMaterialTexturePlacementBucketKey(intent);
		const bucket = grouped.get(bucketKey);
		if (bucket) {
			bucket.push(intent);
		} else {
			grouped.set(bucketKey, [intent]);
		}
	}
	return grouped;
}

function createBindingRequirement(
	bucketKey: OpenWorldTextureBucketKey,
	intent: TexturePlacementIntent<TexturePlacementLookupId>,
): OpenWorldTextureBindingRequirement {
	return {
		affinityKey: intent.affinityKey,
		bindingId: intent.bindingId,
		bucketKey,
		pageClass: intent.pageClass,
		purpose: intent.purpose,
		sourceKey: String(intent.itemId),
		textureKey: intent.textureKey,
	};
}

async function reserveBucketTexturePlacements<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly atlasBuilder: OpenWorldMaterialTextureAtlasBuilder;
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly filteringMode: TextureFilteringMode;
	readonly intents: readonly TIntent[];
	readonly jobPrefix: string;
	readonly snapshot: OpenWorldTextureBucketSnapshot;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}): Promise<OpenWorldMaterialTexturePlacementReservation<TItemId>> {
	const timing = new TexturePlacementStageTimer();
	const intentByBindingId = new Map(
		options.intents.map((intent) => [intent.bindingId, intent] as const),
	);
	const firstIntent = requireFirst(options.intents, options.bucketKey);
	const pagePolicy = createRuntimeTexturePagePolicy(
		firstIntent.source.dataUse,
		firstIntent.source.samplingPolicy,
	);
	const samplerPolicy = createRuntimeTextureSamplerPolicy({
		filteringMode: options.filteringMode,
		sampleClass: pagePolicy.sampleClass,
	});
	const pageGutterPixels = getRuntimeTexturePageGutterPixels(
		firstIntent.domain,
		pagePolicy,
	);
	const touchedEntries = options.snapshot.entries.filter((entry) =>
		entry.bindingIds.some((bindingId) => intentByBindingId.has(bindingId)),
	);
	const planned = await options.atlasBuilder.planAtlasPlacement({
		domain: firstIntent.domain,
		entries: touchedEntries.map((entry) => {
			const intent = requireIntentForEntry(entry.bindingIds, intentByBindingId);
			return {
				dataUse: intent.source.dataUse,
				entryId: entry.id,
				gutterEdgeMode:
					pagePolicy.wrapS === "repeat" && pagePolicy.wrapT === "repeat"
						? "repeat"
						: "clamp",
			};
		}),
		jobId: `${options.jobPrefix}:${options.bucketKey}`,
		page: {
			format: createTexturePackingPageFormat(pagePolicy.sampleClass),
			gutterEdgeMode: "clamp",
			gutterPixels: pageGutterPixels,
			height: MAX_RUNTIME_ATLAS_PAGE_SIZE,
			pageRunway: "one-tier",
			pageSelection: "minimize-textures",
			width: MAX_RUNTIME_ATLAS_PAGE_SIZE,
		},
	});
	timing.append(planned.stageTimings);

	const sourceByEntryId = new Map(
		touchedEntries.map((entry) => [entry.id, entry]),
	);
	const plannedPageById = new Map(
		planned.pages.map((page) => [page.pageId, page] as const),
	);
	const rectsByPageId = groupBy(planned.rects, (rect) => rect.pageId);
	const bindingPlacements: Array<{
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}> = [];
	const pageBuildRequests: OpenWorldTexturePageBuildInput[] = [];

	timing.measureSync("texture-placement-reservation", () => {
		for (const [plannedPageId, rects] of rectsByPageId) {
			timing.measureSync(
				"texture-placement-reservation-page",
				() => {
					const page = plannedPageById.get(plannedPageId);
					if (!page) {
						throw new Error(
							`Planned page ${plannedPageId} is missing layout facts.`,
						);
					}
					const entryIds = rects.map((rect) => rect.entryKey);
					const virtualPage = options.textureClaims.createPage({
						bucketKey: options.bucketKey,
						entryIds,
					});
					const reservationToken = options.textureClaims.reservePageBuild(
						virtualPage.id,
					);
					const textureRefId = `${virtualPage.id}:texture`;
					const pageBindingPlacements = rects.flatMap((rect) => {
						const entry = sourceByEntryId.get(rect.entryKey);
						if (!entry) {
							throw new Error(
								`Planned rect referenced unknown entry ${rect.entryKey}.`,
							);
						}
						return entry.bindingIds.flatMap((bindingId) => {
							const intent = intentByBindingId.get(bindingId);
							if (!intent) {
								return [];
							}
							const placement: TexturePlacement<TItemId> = {
								height: rect.rect[3],
								itemId: intent.itemId,
								ownerIds: [],
								pageClass: intent.pageClass,
								pageId: virtualPage.id,
								purpose: intent.purpose,
								rect: rect.rect,
								textureKey: intent.textureKey,
								textureRefId,
								width: rect.rect[2],
							};
							return {
								bindingId,
								placement,
							};
						});
					});
					pageBuildRequests.push({
						bucketKey: options.bucketKey,
						entries: rects.map((rect) =>
							createPageBuildRequestEntry({
								gutterEdgeMode:
									pagePolicy.wrapS === "repeat" && pagePolicy.wrapT === "repeat"
										? "repeat"
										: "clamp",
								gutterPixels: pageGutterPixels,
								intentByBindingId,
								rect,
								sourceByEntryId,
							}),
						),
						jobId: `${options.jobPrefix}:${options.bucketKey}:${plannedPageId}`,
						page: {
							anisotropy: samplerPolicy.anisotropy,
							filteringMode: samplerPolicy.filteringMode,
							format: createTexturePackingPageFormat(pagePolicy.sampleClass),
							height: page.height,
							mipmapsGenerated: samplerPolicy.generateMipmaps,
							sampleClass: pagePolicy.sampleClass,
							samplerPolicyKey: samplerPolicy.policyKey,
							width: page.width,
							wrapS: pagePolicy.wrapS,
							wrapT: pagePolicy.wrapT,
						},
						pageId: virtualPage.id,
						reservationToken,
					});
					bindingPlacements.push(...pageBindingPlacements);
				},
				rects.length,
			);
		}
	});

	return {
		bindingPlacements,
		pageBuildRequests,
		stageTimings: timing.createSnapshot(),
	};
}

function createPageBuildRequestEntry<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly gutterEdgeMode: "clamp" | "repeat";
	readonly gutterPixels: number;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly rect: OpenWorldObjectVisualAtlasPlacementRect;
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
}): OpenWorldTexturePageBuildInput["entries"][number] {
	const sourceEntry = options.sourceByEntryId.get(options.rect.entryKey);
	if (!sourceEntry) {
		throw new Error(
			`Cannot create page-build entry for unknown texture entry ${options.rect.entryKey}.`,
		);
	}
	const bindingIds = sourceEntry.bindingIds.filter((bindingId) =>
		options.intentByBindingId.has(bindingId),
	);
	if (bindingIds.length === 0) {
		throw new Error(
			`Cannot create page-build entry ${options.rect.entryKey} without live binding ids.`,
		);
	}
	const intent = requireIntentForEntry(bindingIds, options.intentByBindingId);
	return {
		bindingIds,
		dataUse: intent.source.dataUse,
		entryId: sourceEntry.id,
		gutterEdgeMode: options.gutterEdgeMode,
		gutterPixels: options.gutterPixels,
		rect: options.rect.rect,
	};
}

class TexturePlacementStageTimer {
	readonly #timings: OpenWorldStreamingStaticTaskStageTiming[] = [];

	async measure<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => Promise<T>,
		itemCount?: number,
	): Promise<T> {
		const startedAtMs = nowMs();
		try {
			return await createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				...(itemCount === undefined ? {} : { itemCount }),
				stage,
			});
		}
	}

	measureSync<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => T,
		itemCount?: number,
	): T {
		const startedAtMs = nowMs();
		try {
			return createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				...(itemCount === undefined ? {} : { itemCount }),
				stage,
			});
		}
	}

	createSnapshot(): readonly OpenWorldStreamingStaticTaskStageTiming[] {
		return this.#timings;
	}

	append(timings: readonly OpenWorldStreamingStaticTaskStageTiming[]): void {
		this.#timings.push(...timings);
	}
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function createTexturePackingPageFormat(
	sampleClass: ReturnType<typeof createRuntimeTexturePagePolicy>["sampleClass"],
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
	}
}

function requireFirst<T>(items: readonly T[], subject: string): T {
	const item = items[0];
	if (!item) {
		throw new Error(
			`Expected at least one material texture intent for ${subject}.`,
		);
	}
	return item;
}

function requireIntentForEntry<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(
	bindingIds: readonly TextureBindingId[],
	intentsByBindingId: ReadonlyMap<TextureBindingId, TIntent>,
): TIntent {
	for (const bindingId of bindingIds) {
		const intent = intentsByBindingId.get(bindingId);
		if (intent) {
			return intent;
		}
	}
	throw new Error(
		`Texture entry has no matching placement intent: ${bindingIds.join(", ")}`,
	);
}

function groupBy<T, TKey>(
	items: readonly T[],
	getKey: (item: T) => TKey,
): ReadonlyMap<TKey, readonly T[]> {
	const grouped = new Map<TKey, T[]>();
	for (const item of items) {
		const key = getKey(item);
		const group = grouped.get(key);
		if (group) {
			group.push(item);
		} else {
			grouped.set(key, [item]);
		}
	}
	return grouped;
}
