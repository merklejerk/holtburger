import { getRuntimeTexturePageGutterPixels } from "../../../../textures/material-texture-identity";
import type { TextureBindingId } from "../../../../textures/identity";
import type { TexturePackingPageFormat } from "../../../../textures/packing/protocol";
import { planAtlasPageInsertion } from "../../../../textures/packing/atlas-layout";
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
	type OpenWorldTextureEntryPlacementRecord,
	type OpenWorldTexturePagePlacementInput,
	type OpenWorldTexturePagePlacementRecord,
} from "../claims/texture-claim-registry";
import type { OpenWorldTexturePageBuildInput } from "../page-build/protocol";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
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
	/** Renderer-facing binding updates for placements that reused already-resident pages. */
	readonly textureCommits: readonly OpenWorldStreamingTextureCommit[];
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
	const textureCommits: OpenWorldStreamingTextureCommit[] = [];

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
		textureCommits.push(...bucketReservation.textureCommits);
	}

	return {
		bindingPlacements,
		pageBuildRequests,
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
		sourceKey: intent.sourceKey,
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
	const { reusablePlacements, unplacedEntries } = splitReusableEntryPlacements({
		textureClaims: options.textureClaims,
		touchedEntries,
	});
	const sourceByEntryId = new Map(
		options.snapshot.entries.map((entry) => [entry.id, entry]),
	);
	const reusedBindingPlacements = createReusableBakeFacingBindingPlacements<
		TItemId,
		TIntent
	>({
		intentByBindingId,
		placements: reusablePlacements,
		sourceByEntryId,
	});
	const reusedTextureCommit = createReusableResidentTextureCommit({
		bucketKey: options.bucketKey,
		intentByBindingId,
		placements: reusablePlacements,
		sourceByEntryId,
	});
	if (unplacedEntries.length === 0) {
		return {
			bindingPlacements: reusedBindingPlacements,
			pageBuildRequests: [],
			stageTimings: timing.createSnapshot(),
			textureCommits: reusedTextureCommit ? [reusedTextureCommit] : [],
		};
	}
	const layoutInput = createAtlasLayoutInput({
		bucketPlan,
		intentByBindingId,
		jobPrefix: options.jobPrefix,
		touchedEntries: unplacedEntries,
	});
	const planned = await options.atlasBuilder.planAtlasPlacement(layoutInput);
	validateAtlasLayoutOutput({
		input: layoutInput,
		output: planned,
	});
	timing.append(planned.stageTimings);
	const insertion = timing.measureSync(
		"texture-placement-reservation",
		() =>
			planExistingPageInsertion<TItemId, TIntent>({
				bucketKey: options.bucketKey,
				bucketPlan,
				intentByBindingId,
				jobPrefix: options.jobPrefix,
				output: planned,
				sourceByEntryId,
				textureClaims: options.textureClaims,
				touchedEntries: unplacedEntries,
			}),
		unplacedEntries.length,
	);
	if (insertion.remainingEntries.length === 0) {
		return {
			bindingPlacements: [
				...reusedBindingPlacements,
				...insertion.bindingPlacements,
			],
			pageBuildRequests: insertion.pageBuildRequests,
			stageTimings: timing.createSnapshot(),
			textureCommits: reusedTextureCommit ? [reusedTextureCommit] : [],
		};
	}

	const reservation = timing.measureSync(
		"texture-placement-reservation",
		() =>
			reserveAtlasLayoutPages<TItemId, TIntent>({
				bucketKey: options.bucketKey,
				bucketPlan,
				intentByBindingId,
				jobPrefix: options.jobPrefix,
				output: filterAtlasPlacementOutput({
					entryIds: new Set(insertion.remainingEntries.map((entry) => entry.id)),
					output: planned,
				}),
				timing,
				textureClaims: options.textureClaims,
				touchedEntries: insertion.remainingEntries,
			}),
		planned.rects.length,
	);

	return {
		bindingPlacements: [
			...reusedBindingPlacements,
			...insertion.bindingPlacements,
			...reservation.bindingPlacements,
		],
		pageBuildRequests: [
			...insertion.pageBuildRequests,
			...reservation.pageBuildRequests,
		],
		stageTimings: timing.createSnapshot(),
		textureCommits: reusedTextureCommit ? [reusedTextureCommit] : [],
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

function splitReusableEntryPlacements(options: {
	readonly textureClaims: OpenWorldTextureClaimRegistry;
	readonly touchedEntries: readonly OpenWorldTextureBucketSnapshot["entries"][number][];
}): {
	readonly reusablePlacements: readonly OpenWorldTextureEntryPlacementRecord[];
	readonly unplacedEntries: readonly OpenWorldTextureBucketSnapshot["entries"][number][];
} {
	const reusablePlacements: OpenWorldTextureEntryPlacementRecord[] = [];
	const unplacedEntries: OpenWorldTextureBucketSnapshot["entries"][number][] = [];
	for (const entry of options.touchedEntries) {
		const reusable = options.textureClaims.findReusableEntryPlacement(entry.id);
		if (reusable) {
			reusablePlacements.push(reusable);
		} else {
			unplacedEntries.push(entry);
		}
	}
	return {
		reusablePlacements,
		unplacedEntries,
	};
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

function planExistingPageInsertion<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly bucketPlan: MaterialTextureBucketPlacementPlan;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly jobPrefix: string;
	readonly output: OpenWorldMaterialTextureAtlasPlacementOutput;
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
	readonly touchedEntries: readonly OpenWorldTextureBucketSnapshot["entries"][number][];
}): {
	readonly bindingPlacements: OpenWorldMaterialTexturePlacementReservation<TItemId>["bindingPlacements"];
	readonly pageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
	readonly remainingEntries: readonly OpenWorldTextureBucketSnapshot["entries"][number][];
} {
	const candidates = options.textureClaims.createResidentPageInsertionCandidates(
		options.bucketKey,
	);
	if (candidates.length === 0 || options.touchedEntries.length === 0) {
		return {
			bindingPlacements: [],
			pageBuildRequests: [],
			remainingEntries: options.touchedEntries,
		};
	}
	const candidateByTextureIndex = new Map(
		candidates.map((candidate, index) => [index, candidate] as const),
	);
	const insertion = planAtlasPageInsertion({
		entries: options.output.sourceFacts.map((sourceFact) => ({
			height: sourceFact.height,
			key: sourceFact.entryKey,
			width: sourceFact.width,
		})),
		lockedPages: candidates.map((candidate, textureIndex) => ({
			height: candidate.textureHeight,
			placements: candidate.placements.map((placement) => ({
				atlasEntryKey: placement.entryId,
				gutterPixels: placement.gutterPixels,
				height: placement.rect[3],
				textureIndex,
				width: placement.rect[2],
				x: placement.rect[0],
				y: placement.rect[1],
			})),
			textureIndex,
			width: candidate.textureWidth,
		})),
		policy: {
			gutterPixels: options.bucketPlan.gutterPixels,
			maxTextureCount: candidates.length,
			maxTextureSize: MAX_RUNTIME_ATLAS_PAGE_SIZE,
			pageSelection: "minimize-textures",
		},
	});
	if (insertion.insertedPlacementsByEntryKey.size === 0) {
		return {
			bindingPlacements: [],
			pageBuildRequests: [],
			remainingEntries: options.touchedEntries,
		};
	}

	const insertedRectsByPageId = new Map<
		string,
		OpenWorldObjectVisualAtlasPlacementRect[]
	>();
	for (const placement of insertion.insertedPlacementsByEntryKey.values()) {
		const candidate = candidateByTextureIndex.get(placement.textureIndex);
		if (!candidate) {
			throw new Error(
				`Inserted texture placement referenced missing page index ${placement.textureIndex}.`,
			);
		}
		const rect: OpenWorldObjectVisualAtlasPlacementRect = {
			entryKey: placement.atlasEntryKey as OpenWorldTextureEntryId,
			pageId: candidate.pageId,
			rect: [
				placement.x,
				placement.y,
				placement.width,
				placement.height,
			],
		};
		const bucket = insertedRectsByPageId.get(candidate.pageId);
		if (bucket) {
			bucket.push(rect);
		} else {
			insertedRectsByPageId.set(candidate.pageId, [rect]);
		}
	}

	const bindingPlacements: Array<{
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TItemId>;
	}> = [];
	const pageBuildRequests: OpenWorldTexturePageBuildInput[] = [];
	for (const [pageId, rects] of insertedRectsByPageId) {
		const candidate = candidates.find((page) => page.pageId === pageId);
		if (!candidate) {
			throw new Error(`Inserted texture page ${pageId} has no candidate facts.`);
		}
		options.textureClaims.addEntryPlacementsToPage({
			pageId: candidate.pageId,
			placements: rects.map((rect) =>
				createPagePlacementInput({
					bucketPlan: options.bucketPlan,
					intentByBindingId: options.intentByBindingId,
					rect,
					sourceByEntryId: options.sourceByEntryId,
				}),
			),
		});
		const reservationToken = options.textureClaims.reservePageBuild(
			candidate.pageId,
		);
		const pageBuildEntries =
			options.textureClaims.createPagePlacementRecordsForPage(candidate.pageId);
		pageBuildRequests.push({
			bucketKey: options.bucketKey,
			entries: pageBuildEntries.map((placement) =>
				createPageBuildRequestEntryFromPlacementRecord({
					placement,
					sourceByEntryId: options.sourceByEntryId,
				}),
			),
			jobId: `${options.jobPrefix}:${options.bucketKey}:insert:${candidate.pageId}`,
			page: createPageBuildRequestPage({
				bucketPlan: options.bucketPlan,
				height: candidate.textureHeight,
				width: candidate.textureWidth,
			}),
			pageId: candidate.pageId,
			reservationToken,
		});
		bindingPlacements.push(
			...createBakeFacingBindingPlacements<TItemId, TIntent>({
				intentByBindingId: options.intentByBindingId,
				rects,
				sourceByEntryId: options.sourceByEntryId,
				textureRefId: candidate.textureRefId,
				virtualPageId: candidate.pageId,
			}),
		);
	}
	const insertedEntryIds = new Set(
		[...insertion.insertedPlacementsByEntryKey.keys()] as OpenWorldTextureEntryId[],
	);
	return {
		bindingPlacements,
		pageBuildRequests,
		remainingEntries: options.touchedEntries.filter(
			(entry) => !insertedEntryIds.has(entry.id),
		),
	};
}

function filterAtlasPlacementOutput(options: {
	readonly entryIds: ReadonlySet<OpenWorldTextureEntryId>;
	readonly output: OpenWorldMaterialTextureAtlasPlacementOutput;
}): OpenWorldMaterialTextureAtlasPlacementOutput {
	const rects = options.output.rects.filter((rect) =>
		options.entryIds.has(rect.entryKey),
	);
	const pageIds = new Set(rects.map((rect) => rect.pageId));
	return {
		pages: options.output.pages.filter((page) => pageIds.has(page.pageId)),
		rects,
		sourceFacts: options.output.sourceFacts.filter((sourceFact) =>
			options.entryIds.has(sourceFact.entryKey),
		),
		stageTimings: [],
	};
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
		placements: options.rects.map((rect) =>
			createPagePlacementInput({
				bucketPlan: options.bucketPlan,
				intentByBindingId: options.intentByBindingId,
				rect,
				sourceByEntryId: options.sourceByEntryId,
			}),
		),
		textureHeight: options.page.height,
		textureWidth: options.page.width,
	});
	const reservationToken = options.textureClaims.reservePageBuild(
		virtualPage.id,
	);
	return {
		bindingPlacements: createBakeFacingBindingPlacements<TItemId, TIntent>({
			intentByBindingId: options.intentByBindingId,
			rects: options.rects,
			sourceByEntryId: options.sourceByEntryId,
			textureRefId: virtualPage.textureRefId,
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
			page: createPageBuildRequestPage({
				bucketPlan: options.bucketPlan,
				height: options.page.height,
				width: options.page.width,
			}),
			pageId: virtualPage.id,
			reservationToken,
		},
	};
}

function createPagePlacementInput<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly bucketPlan: MaterialTextureBucketPlacementPlan;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly rect: OpenWorldObjectVisualAtlasPlacementRect;
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
}): OpenWorldTexturePagePlacementInput {
	const sourceEntry = requireSourceEntry(
		options.sourceByEntryId,
		options.rect.entryKey,
	);
	const intent = requireIntentForEntry(
		sourceEntry.bindingIds,
		options.intentByBindingId,
	);
	return {
		dataUse: intent.source.dataUse,
		entryId: options.rect.entryKey,
		gutterEdgeMode: options.bucketPlan.gutterEdgeMode,
		gutterPixels: options.bucketPlan.gutterPixels,
		rect: options.rect.rect,
	};
}

function createPageBuildRequestPage(options: {
	readonly bucketPlan: MaterialTextureBucketPlacementPlan;
	readonly height: number;
	readonly width: number;
}): OpenWorldTexturePageBuildInput["page"] {
	return {
		anisotropy: options.bucketPlan.samplerPolicy.anisotropy,
		filteringMode: options.bucketPlan.samplerPolicy.filteringMode,
		format: options.bucketPlan.format,
		height: options.height,
		mipmapsGenerated: options.bucketPlan.samplerPolicy.generateMipmaps,
		sampleClass: options.bucketPlan.pagePolicy.sampleClass,
		samplerPolicyKey: options.bucketPlan.samplerPolicy.policyKey,
		width: options.width,
		wrapS: options.bucketPlan.pagePolicy.wrapS,
		wrapT: options.bucketPlan.pagePolicy.wrapT,
	};
}

function createReusableBakeFacingBindingPlacements<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly placements: readonly OpenWorldTextureEntryPlacementRecord[];
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
}): OpenWorldMaterialTexturePlacementReservation<TItemId>["bindingPlacements"] {
	return options.placements.flatMap((placement) => {
		const entry = requireSourceEntry(options.sourceByEntryId, placement.entryId);
		return entry.bindingIds.flatMap((bindingId) => {
			const intent = options.intentByBindingId.get(bindingId);
			if (!intent) {
				return [];
			}
			return {
				bindingId,
				placement: createTexturePlacementFromEntryPlacement<TItemId, TIntent>({
					intent,
					placement,
				}),
			};
		});
	});
}

function createReusableResidentTextureCommit<
	TIntent extends TexturePlacementIntent<TexturePlacementLookupId>,
>(options: {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly intentByBindingId: ReadonlyMap<TextureBindingId, TIntent>;
	readonly placements: readonly OpenWorldTextureEntryPlacementRecord[];
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
}): OpenWorldStreamingTextureCommit | null {
	const bindingUpdates = options.placements.flatMap((placement) => {
		if (placement.pageState === "building") {
			return [];
		}
		const entry = requireSourceEntry(options.sourceByEntryId, placement.entryId);
		return entry.bindingIds.flatMap((bindingId) => {
			if (!options.intentByBindingId.has(bindingId)) {
				return [];
			}
			return {
				bindingId,
				readiness: {
					kind: "resident" as const,
					pageVersion: {
						placementRevision: 0,
						textureRefId: placement.textureRefId,
					},
					rect: placement.rect,
					textureHeight: placement.textureHeight,
					textureRefId: placement.textureRefId,
					textureWidth: placement.textureWidth,
				},
			};
		});
	});
	if (bindingUpdates.length === 0) {
		return null;
	}
	return {
		bindingRemovals: [],
		bindingUpdates,
		bucketKey: options.bucketKey,
		kind: "texture-commit",
		pageRemovals: [],
		pageUpdates: [],
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
			return {
				bindingId,
				placement: {
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
				},
			};
		});
	});
}

function createTexturePlacementFromEntryPlacement<
	TItemId extends TexturePlacementLookupId,
	TIntent extends TexturePlacementIntent<TItemId>,
>(options: {
	readonly intent: TIntent;
	readonly placement: OpenWorldTextureEntryPlacementRecord;
}): TexturePlacement<TItemId> {
	return {
		height: options.placement.rect[3],
		itemId: options.intent.itemId,
		ownerIds: [],
		pageClass: options.intent.pageClass,
		pageId: options.placement.pageId,
		purpose: options.intent.purpose,
		rect: options.placement.rect,
		textureKey: options.intent.textureKey,
		textureRefId: options.placement.textureRefId,
		width: options.placement.rect[2],
	};
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

function createPageBuildRequestEntryFromPlacementRecord(options: {
	readonly placement: OpenWorldTexturePagePlacementRecord;
	readonly sourceByEntryId: ReadonlyMap<
		OpenWorldTextureEntryId,
		OpenWorldTextureBucketSnapshot["entries"][number]
	>;
}): OpenWorldTexturePageBuildInput["entries"][number] {
	const sourceEntry = options.sourceByEntryId.get(options.placement.entryId);
	if (!sourceEntry) {
		throw new Error(
			`Cannot rebuild page entry for unknown texture entry ${options.placement.entryId}.`,
		);
	}
	return {
		bindingIds: sourceEntry.bindingIds,
		dataUse: options.placement.dataUse,
		entryId: options.placement.entryId,
		gutterEdgeMode: options.placement.gutterEdgeMode,
		gutterPixels: options.placement.gutterPixels,
		rect: options.placement.rect,
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
