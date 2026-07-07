import { getRuntimeTexturePageGutterPixels } from "../../../../textures/material-texture-identity";
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
import type { TextureBindingId } from "../../../../textures/identity";
import type { TexturePackingPageFormat } from "../../../../textures/packing/protocol";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import { createOpenWorldTextureBucketKey } from "../claims/bucket-key";
import type { OpenWorldTextureBucketKey } from "../claims/bucket-key";
import {
	OpenWorldTextureClaimRegistry,
	type OpenWorldTextureBindingRequirement,
	type OpenWorldTextureBucketSnapshot,
	type OpenWorldTextureEntryId,
} from "../claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
import { settleOpenWorldTexturePageBuildResult } from "../page-build/page-build-results";
import type { OpenWorldMaterialTextureAtlasBuilder } from "./object-visual-atlas-builder";

const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;

export interface OpenWorldMaterialTexturePlacementPlanOptions<
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

export interface OpenWorldMaterialTexturePlacementPlan<
	TItemId extends TexturePlacementLookupId,
> {
	readonly bindingPlacements: readonly {
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}[];
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly textureCommits: readonly OpenWorldStreamingTextureCommit[];
}

export async function buildMaterialTexturePlacementPlan<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(
	options: OpenWorldMaterialTexturePlacementPlanOptions<TItemId, TIntent>,
): Promise<OpenWorldMaterialTexturePlacementPlan<TItemId>> {
	const intentsByBucket = groupMaterialTextureIntentsByBucket(options.intents);
	const bindingPlacements: Array<{
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}> = [];
	const stageTimings: OpenWorldStreamingStaticTaskStageTiming[] = [];
	const textureCommits: OpenWorldStreamingTextureCommit[] = [];

	for (const [bucketKey, intents] of intentsByBucket) {
		const snapshot = options.textureClaims.retainTextureBindings(
			options.ownerId,
			bucketKey,
			intents.map((intent) => createBindingRequirement(bucketKey, intent)),
		);
		const bucketPlan = await buildBucketTextureCommit<TItemId, TIntent>({
			atlasBuilder: options.atlasBuilder,
			bucketKey,
			filteringMode: options.filteringMode,
			intents,
			jobPrefix: options.jobPrefix,
			snapshot,
			textureClaims: options.textureClaims,
		});
		bindingPlacements.push(...bucketPlan.bindingPlacements);
		stageTimings.push(...bucketPlan.stageTimings);
		textureCommits.push(...bucketPlan.textureCommits);
	}

	return {
		bindingPlacements,
		stageTimings,
		textureCommits,
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
		const bucketKey = createOpenWorldTextureBucketKey({
			domain: intent.domain,
			purpose: intent.purpose,
			scope: { kind: "static-domain" },
		});
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

async function buildBucketTextureCommit<
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
}): Promise<OpenWorldMaterialTexturePlacementPlan<TItemId>> {
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
	const touchedEntries = options.snapshot.entries.filter((entry) =>
		entry.bindingIds.some((bindingId) => intentByBindingId.has(bindingId)),
	);
	const packed = await options.atlasBuilder.buildAtlas({
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
			gutterPixels: getRuntimeTexturePageGutterPixels(
				firstIntent.domain,
				pagePolicy,
			),
			height: MAX_RUNTIME_ATLAS_PAGE_SIZE,
			pageRunway: "one-tier",
			pageSelection: "minimize-textures",
			width: MAX_RUNTIME_ATLAS_PAGE_SIZE,
		},
	});
	timing.append(packed.stageTimings);

	const packedPageById = new Map(
		packed.pages.map((page) => [page.pageId, page] as const),
	);
	const sourceByEntryId = new Map(
		touchedEntries.map((entry) => [entry.id, entry]),
	);
	const rectsByPageId = groupBy(packed.rects, (rect) => rect.pageId);
	const bindingPlacements: Array<{
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}> = [];
	const textureCommits: OpenWorldStreamingTextureCommit[] = [];

	timing.measureSync("texture-page-settlement", () => {
		for (const [packedPageId, rects] of rectsByPageId) {
			timing.measureSync(
				"texture-page-settlement-page",
				() => {
					const page = packedPageById.get(packedPageId);
					if (!page) {
						throw new Error(
							`Packed page ${packedPageId} is missing pixel payload.`,
						);
					}
					const entryIds = rects.map(
						(rect) => rect.entryKey as OpenWorldTextureEntryId,
					);
					const virtualPage = options.textureClaims.createPage({
						bucketKey: options.bucketKey,
						entryIds,
					});
					const reservationToken = options.textureClaims.reservePageBuild(
						virtualPage.id,
					);
					const textureRefId = `${virtualPage.id}:texture`;
					const pageBindingPlacements = rects.flatMap((rect) => {
						const entry = sourceByEntryId.get(
							rect.entryKey as OpenWorldTextureEntryId,
						);
						if (!entry) {
							throw new Error(
								`Packed rect referenced unknown entry ${rect.entryKey}.`,
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
					const settlement = settleOpenWorldTexturePageBuildResult(
						options.textureClaims,
						{
							bucketKey: options.bucketKey,
							jobId: `${options.jobPrefix}:${options.bucketKey}:${packedPageId}`,
							kind: "page-update",
							page: {
								anisotropy: samplerPolicy.anisotropy,
								filteringMode: samplerPolicy.filteringMode,
								format: page.format,
								height: page.height,
								mipmapsGenerated: samplerPolicy.generateMipmaps,
								pixels: page.pixels,
								sampleClass: pagePolicy.sampleClass,
								samplerPolicyKey: samplerPolicy.policyKey,
								textureRefId,
								width: page.width,
								wrapS: pagePolicy.wrapS,
								wrapT: pagePolicy.wrapT,
							},
							pageId: virtualPage.id,
							placements: pageBindingPlacements.map((placement) => ({
								bindingId: placement.bindingId,
								rect: placement.placement.rect,
							})),
							reservationToken,
						},
					);
					if (settlement.kind === "stale") {
						throw new Error(
							`Texture page build unexpectedly became stale for ${virtualPage.id}.`,
						);
					}
					if (settlement.commit) {
						textureCommits.push(settlement.commit);
					}
					bindingPlacements.push(...pageBindingPlacements);
				},
				rects.length,
			);
		}
	});

	return {
		bindingPlacements,
		stageTimings: timing.createSnapshot(),
		textureCommits,
	};
}

class TexturePlacementStageTimer {
	readonly #timings: OpenWorldStreamingStaticTaskStageTiming[] = [];

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
