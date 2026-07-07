import { getRuntimeTexturePageGutterPixels } from "../../../../textures/material-texture-identity";
import type { TextureBindingId } from "../../../../textures/identity";
import type { TexturePackingPageFormat } from "../../../../textures/packing/protocol";
import type { VisualTextureDomain } from "../../../../static/contracts";
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
	OpenWorldMaterialTextureAtlasBuildInput,
	OpenWorldMaterialTextureAtlasPlacementOutput,
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
	const bucketPlan = createBucketPlacementPlan({
		bucketKey: options.bucketKey,
		filteringMode: options.filteringMode,
		firstIntent,
	});
	const touchedEntries = selectTouchedBucketEntries({
		intentByBindingId,
		snapshot: options.snapshot,
	});
	const layoutInput = createAtlasLayoutInput({
		bucketPlan,
		intentByBindingId,
		jobPrefix: options.jobPrefix,
		touchedEntries,
	});
	const planned = await options.atlasBuilder.planAtlasPlacement(layoutInput);
	validateAtlasLayoutOutput({
		input: layoutInput,
		output: planned,
	});
	timing.append(planned.stageTimings);

	const reservation = timing.measureSync(
		"texture-placement-reservation",
		() =>
			reserveAtlasLayoutPages<TItemId, TIntent>({
				bucketKey: options.bucketKey,
				bucketPlan,
				intentByBindingId,
				jobPrefix: options.jobPrefix,
				output: planned,
				timing,
				textureClaims: options.textureClaims,
				touchedEntries,
			}),
		planned.rects.length,
	);

	return {
		...reservation,
		stageTimings: timing.createSnapshot(),
	};
}

function createBucketPlacementPlan<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly filteringMode: TextureFilteringMode;
	readonly firstIntent: TIntent;
}): MaterialTextureBucketPlacementPlan {
	const pagePolicy = createRuntimeTexturePagePolicy(
		options.firstIntent.source.dataUse,
		options.firstIntent.source.samplingPolicy,
	);
	const samplerPolicy = createRuntimeTextureSamplerPolicy({
		filteringMode: options.filteringMode,
		sampleClass: pagePolicy.sampleClass,
	});
	return {
		bucketKey: options.bucketKey,
		domain: options.firstIntent.domain,
		format: createTexturePackingPageFormat(pagePolicy.sampleClass),
		gutterEdgeMode:
			pagePolicy.wrapS === "repeat" && pagePolicy.wrapT === "repeat"
				? "repeat"
				: "clamp",
		gutterPixels: getRuntimeTexturePageGutterPixels(
			options.firstIntent.domain,
			pagePolicy,
		),
		pagePolicy,
		samplerPolicy,
	};
}

interface MaterialTextureBucketPlacementPlan {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly domain: VisualTextureDomain;
	readonly format: TexturePackingPageFormat;
	readonly gutterEdgeMode: "clamp" | "repeat";
	readonly gutterPixels: number;
	readonly pagePolicy: ReturnType<typeof createRuntimeTexturePagePolicy>;
	readonly samplerPolicy: ReturnType<typeof createRuntimeTextureSamplerPolicy>;
}

function selectTouchedBucketEntries(options: {
	readonly intentByBindingId: ReadonlyMap<
		TextureBindingId,
		TexturePlacementIntent<TexturePlacementLookupId>
	>;
	readonly snapshot: OpenWorldTextureBucketSnapshot;
}): readonly OpenWorldTextureBucketSnapshot["entries"][number][] {
	return options.snapshot.entries.filter((entry) =>
		entry.bindingIds.some((bindingId) =>
			options.intentByBindingId.has(bindingId),
		),
	);
}

function createAtlasLayoutInput<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly bucketPlan: MaterialTextureBucketPlacementPlan;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly jobPrefix: string;
	readonly touchedEntries: readonly OpenWorldTextureBucketSnapshot["entries"][number][];
}): OpenWorldMaterialTextureAtlasBuildInput {
	return {
		domain: options.bucketPlan.domain,
		entries: options.touchedEntries.map((entry) => {
			const intent = requireIntentForEntry(
				entry.bindingIds,
				options.intentByBindingId,
			);
			return {
				dataUse: intent.source.dataUse,
				entryId: entry.id,
				gutterEdgeMode: options.bucketPlan.gutterEdgeMode,
			};
		}),
		jobId: `${options.jobPrefix}:${options.bucketPlan.bucketKey}`,
		page: {
			format: options.bucketPlan.format,
			gutterEdgeMode: "clamp",
			gutterPixels: options.bucketPlan.gutterPixels,
			height: MAX_RUNTIME_ATLAS_PAGE_SIZE,
			pageRunway: "one-tier",
			pageSelection: "minimize-textures",
			width: MAX_RUNTIME_ATLAS_PAGE_SIZE,
		},
	};
}

function validateAtlasLayoutOutput(options: {
	readonly input: OpenWorldMaterialTextureAtlasBuildInput;
	readonly output: OpenWorldMaterialTextureAtlasPlacementOutput;
}): void {
	const sourceFactsByEntryId = new Map(
		options.output.sourceFacts.map(
			(sourceFact) => [sourceFact.entryKey, sourceFact] as const,
		),
	);
	for (const inputEntry of options.input.entries) {
		if (!sourceFactsByEntryId.has(inputEntry.entryId)) {
			throw new Error(
				`Texture layout job ${options.input.jobId} did not return source facts for ${inputEntry.entryId}.`,
			);
		}
	}
	for (const rect of options.output.rects) {
		const sourceFact = sourceFactsByEntryId.get(rect.entryKey);
		if (!sourceFact) {
			throw new Error(
				`Texture layout job ${options.input.jobId} returned rect for ${rect.entryKey} without source facts.`,
			);
		}
		if (
			rect.rect[2] !== sourceFact.width ||
			rect.rect[3] !== sourceFact.height
		) {
			throw new Error(
				`Texture layout job ${options.input.jobId} rect for ${rect.entryKey} is ${rect.rect[2]}x${rect.rect[3]}, but source facts are ${sourceFact.width}x${sourceFact.height}.`,
			);
		}
	}
}

function reserveAtlasLayoutPages<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly bucketPlan: MaterialTextureBucketPlacementPlan;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly jobPrefix: string;
	readonly output: OpenWorldMaterialTextureAtlasPlacementOutput;
	readonly timing: TexturePlacementStageTimer;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
	readonly touchedEntries: readonly OpenWorldTextureBucketSnapshot["entries"][number][];
}): {
	readonly bindingPlacements: OpenWorldMaterialTexturePlacementReservation<TItemId>["bindingPlacements"];
	readonly pageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
} {
	const sourceByEntryId = new Map(
		options.touchedEntries.map((entry) => [entry.id, entry]),
	);
	const plannedPageById = new Map(
		options.output.pages.map((page) => [page.pageId, page] as const),
	);
	const rectsByPageId = groupBy(options.output.rects, (rect) => rect.pageId);
	const bindingPlacements: Array<{
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}> = [];
	const pageBuildRequests: OpenWorldTexturePageBuildInput[] = [];

	for (const [plannedPageId, rects] of rectsByPageId) {
		const pageReservation = options.timing.measureSync(
			"texture-placement-reservation-page",
			() =>
				reserveAtlasLayoutPage<TItemId, TIntent>({
					bucketKey: options.bucketKey,
					bucketPlan: options.bucketPlan,
					intentByBindingId: options.intentByBindingId,
					jobPrefix: options.jobPrefix,
					page: requirePlannedPage(plannedPageById, plannedPageId),
					plannedPageId,
					rects,
					sourceByEntryId,
					textureClaims: options.textureClaims,
				}),
			rects.length,
		);
		bindingPlacements.push(...pageReservation.bindingPlacements);
		pageBuildRequests.push(pageReservation.pageBuildRequest);
	}

	return {
		bindingPlacements,
		pageBuildRequests,
	};
}

function reserveAtlasLayoutPage<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly bucketPlan: MaterialTextureBucketPlacementPlan;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly jobPrefix: string;
	readonly page: OpenWorldMaterialTextureAtlasPlacementOutput["pages"][number];
	readonly plannedPageId: string;
	readonly rects: readonly OpenWorldObjectVisualAtlasPlacementRect[];
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}): {
	readonly bindingPlacements: OpenWorldMaterialTexturePlacementReservation<TItemId>["bindingPlacements"];
	readonly pageBuildRequest: OpenWorldTexturePageBuildInput;
} {
	const entryIds = options.rects.map((rect) => rect.entryKey);
	const virtualPage = options.textureClaims.createPage({
		bucketKey: options.bucketKey,
		entryIds,
	});
	const reservationToken = options.textureClaims.reservePageBuild(
		virtualPage.id,
	);
	const textureRefId = `${virtualPage.id}:texture`;
	return {
		bindingPlacements: createBakeFacingBindingPlacements<TItemId, TIntent>({
			intentByBindingId: options.intentByBindingId,
			rects: options.rects,
			sourceByEntryId: options.sourceByEntryId,
			textureRefId,
			virtualPageId: virtualPage.id,
		}),
		pageBuildRequest: {
			bucketKey: options.bucketKey,
			entries: options.rects.map((rect) =>
				createPageBuildRequestEntry({
					gutterEdgeMode: options.bucketPlan.gutterEdgeMode,
					gutterPixels: options.bucketPlan.gutterPixels,
					intentByBindingId: options.intentByBindingId,
					rect,
					sourceByEntryId: options.sourceByEntryId,
				}),
			),
			jobId: `${options.jobPrefix}:${options.bucketKey}:${options.plannedPageId}`,
			page: {
				anisotropy: options.bucketPlan.samplerPolicy.anisotropy,
				filteringMode: options.bucketPlan.samplerPolicy.filteringMode,
				format: options.bucketPlan.format,
				height: options.page.height,
				mipmapsGenerated: options.bucketPlan.samplerPolicy.generateMipmaps,
				sampleClass: options.bucketPlan.pagePolicy.sampleClass,
				samplerPolicyKey: options.bucketPlan.samplerPolicy.policyKey,
				width: options.page.width,
				wrapS: options.bucketPlan.pagePolicy.wrapS,
				wrapT: options.bucketPlan.pagePolicy.wrapT,
			},
			pageId: virtualPage.id,
			reservationToken,
		},
	};
}

function createBakeFacingBindingPlacements<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly rects: readonly OpenWorldObjectVisualAtlasPlacementRect[];
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
	readonly textureRefId: string;
	readonly virtualPageId: string;
}): OpenWorldMaterialTexturePlacementReservation<TItemId>["bindingPlacements"] {
	return options.rects.flatMap((rect) => {
		const entry = requireSourceEntry(options.sourceByEntryId, rect.entryKey);
		return entry.bindingIds.flatMap((bindingId) => {
			const intent = options.intentByBindingId.get(bindingId);
			if (!intent) {
				return [];
			}
			const placement: TexturePlacement<TItemId> = {
				height: rect.rect[3],
				itemId: intent.itemId,
				ownerIds: [],
				pageClass: intent.pageClass,
				pageId: options.virtualPageId,
				purpose: intent.purpose,
				rect: rect.rect,
				textureKey: intent.textureKey,
				textureRefId: options.textureRefId,
				width: rect.rect[2],
			};
			return {
				bindingId,
				placement,
			};
		});
	});
}

function requirePlannedPage(
	plannedPageById: ReadonlyMap<
		string,
		OpenWorldMaterialTextureAtlasPlacementOutput["pages"][number]
	>,
	plannedPageId: string,
): OpenWorldMaterialTextureAtlasPlacementOutput["pages"][number] {
	const page = plannedPageById.get(plannedPageId);
	if (!page) {
		throw new Error(`Planned page ${plannedPageId} is missing layout facts.`);
	}
	return page;
}

function requireSourceEntry(
	sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>,
	entryId: OpenWorldTextureEntryId,
): OpenWorldTextureBucketSnapshot["entries"][number] {
	const entry = sourceByEntryId.get(entryId);
	if (!entry) {
		throw new Error(`Planned rect referenced unknown entry ${entryId}.`);
	}
	return entry;
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
