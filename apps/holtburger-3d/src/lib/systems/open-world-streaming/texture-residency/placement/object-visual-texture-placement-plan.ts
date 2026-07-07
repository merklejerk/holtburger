import { getRuntimeTexturePageGutterPixels } from "../../../../textures/material-texture-identity";
import type {
	ObjectVisualTexturePlacementIntent,
	ObjectVisualTexturePlacementSnapshot,
	TexturePlacement,
	TexturePlacementItemId,
} from "../../../../textures/placement";
import { createTexturePlacementItemId } from "../../../../textures/placement";
import {
	createRuntimeTexturePagePolicy,
	createRuntimeTextureSamplerPolicy,
} from "../../../../textures/sampling-policy";
import type { TexturePackingPageFormat } from "../../../../textures/packing/protocol";
import type { TextureBindingId } from "../../../../textures/identity";
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
import type { OpenWorldObjectVisualAtlasBuilder } from "./object-visual-atlas-builder";

const MAX_RUNTIME_ATLAS_PAGE_SIZE = 2048;
export interface OpenWorldObjectVisualTexturePlacementPlanOptions {
	readonly atlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly filteringMode: "nearest" | "linear" | "anisotropic-4x";
	readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	readonly ownerId: MaterializationOwnerId;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldObjectVisualTexturePlacementPlan {
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly textureCommits: readonly OpenWorldStreamingTextureCommit[];
}

export async function buildObjectVisualTexturePlacementPlan(
	options: OpenWorldObjectVisualTexturePlacementPlanOptions,
): Promise<OpenWorldObjectVisualTexturePlacementPlan> {
	const intents = createBakeLocalObjectVisualIntents(options.intents);
	const intentsByBucket = groupObjectVisualIntentsByBucket(intents);
	const placementsByItemId = new Map<
		TexturePlacementItemId,
		TexturePlacement<TexturePlacementItemId>
	>();
	const itemIdsByBindingId = new Map<
		TextureBindingId,
		TexturePlacementItemId
	>();
	const placementsByBindingId = new Map<
		TextureBindingId,
		{
			readonly bindingId: TextureBindingId;
			readonly placement: TexturePlacement<TexturePlacementItemId>;
		}
	>();
	const stageTimings: OpenWorldStreamingStaticTaskStageTiming[] = [];
	const textureCommits: OpenWorldStreamingTextureCommit[] = [];

	for (const [bucketKey, intents] of intentsByBucket) {
		const snapshot = options.textureClaims.retainTextureBindings(
			options.ownerId,
			bucketKey,
			intents.map((intent) => createBindingRequirement(bucketKey, intent)),
		);
		const bucketPlan = await buildBucketTextureCommit({
			atlasBuilder: options.atlasBuilder,
			bucketKey,
			filteringMode: options.filteringMode,
			intents,
			snapshot,
			textureClaims: options.textureClaims,
		});
		stageTimings.push(...bucketPlan.stageTimings);
		textureCommits.push(...bucketPlan.textureCommits);
		for (const binding of bucketPlan.bindingPlacements) {
			itemIdsByBindingId.set(binding.bindingId, binding.placement.itemId);
			placementsByBindingId.set(binding.bindingId, binding);
			placementsByItemId.set(binding.placement.itemId, binding.placement);
		}
	}

	return {
		placementSnapshot: {
			itemIdsByBindingId,
			placementsByBindingId,
			placementsByItemId,
		},
		stageTimings,
		textureCommits,
	};
}

function createBakeLocalObjectVisualIntents(
	intents: readonly ObjectVisualTexturePlacementIntent[],
): readonly ObjectVisualTexturePlacementIntent[] {
	return intents.map((intent, index) => ({
		...intent,
		itemId: createTexturePlacementItemId(index),
	}));
}

function groupObjectVisualIntentsByBucket(
	intents: readonly ObjectVisualTexturePlacementIntent[],
): ReadonlyMap<
	OpenWorldTextureBucketKey,
	readonly ObjectVisualTexturePlacementIntent[]
> {
	const grouped = new Map<
		OpenWorldTextureBucketKey,
		ObjectVisualTexturePlacementIntent[]
	>();
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
	intent: ObjectVisualTexturePlacementIntent,
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

async function buildBucketTextureCommit(options: {
	readonly atlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly filteringMode: "nearest" | "linear" | "anisotropic-4x";
	readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	readonly snapshot: OpenWorldTextureBucketSnapshot;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}): Promise<{
	readonly bindingPlacements: readonly {
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TexturePlacementItemId>;
	}[];
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly textureCommits: readonly OpenWorldStreamingTextureCommit[];
}> {
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
		jobId: `open-world-object-visual:${options.bucketKey}`,
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
		readonly placement: TexturePlacement<TexturePlacementItemId>;
	}> = [];
	const textureCommits: OpenWorldStreamingTextureCommit[] = [];

	timing.measureSync("texture-page-settlement", () => {
		for (const [packedPageId, rects] of rectsByPageId) {
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
					const placement: TexturePlacement<TexturePlacementItemId> = {
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
					jobId: `open-world-object-visual:${options.bucketKey}:${packedPageId}`,
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
						wrapS: "clamp-to-edge",
						wrapT: "clamp-to-edge",
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
					`Object visual page build unexpectedly became stale for ${virtualPage.id}.`,
				);
			}
			if (settlement.commit) {
				textureCommits.push(settlement.commit);
			}
			bindingPlacements.push(...pageBindingPlacements);
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

	async measure<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => Promise<T>,
	): Promise<T> {
		const startedAtMs = nowMs();
		try {
			return await createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				stage,
			});
		}
	}

	measureSync<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => T,
	): T {
		const startedAtMs = nowMs();
		try {
			return createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
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
			`Expected at least one object visual texture intent for ${subject}.`,
		);
	}
	return item;
}

function requireIntentForEntry(
	bindingIds: readonly TextureBindingId[],
	intentsByBindingId: ReadonlyMap<
		TextureBindingId,
		ObjectVisualTexturePlacementIntent
	>,
): ObjectVisualTexturePlacementIntent {
	for (const bindingId of bindingIds) {
		const intent = intentsByBindingId.get(bindingId);
		if (intent) {
			return intent;
		}
	}
	throw new Error(
		`Texture entry has no matching object visual placement intent: ${bindingIds.join(", ")}`,
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
