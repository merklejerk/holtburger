import type { AssetChannelState } from "../assets/types";
import type { SceneCameraFrame } from "./camera";
import { buildSceneCameraViewProjectionMatrix, type LumaMat4 } from "./luma-math";
import type {
	LumaWorldDrawBatch,
	LumaWorldDrawBatchKind,
} from "./luma-resources";
import { derivePreparedBvhVisibilitySnapshot } from "./prepared-bvh-metrics";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderFrustum, RenderPlane } from "./render-spatial-math";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

type LumaDrawCategory =
	| "terrain"
	| "structured-interior"
	| "static-staged"
	| "static"
	| "portal-mask"
	| "debug-overlay";

interface LumaDraw {
	batchId: string;
	category: LumaDrawCategory;
}

interface LumaPass {
	id: "world";
	draws: LumaDraw[];
}

export interface LumaFrameMetrics {
	registeredBatchCount: number;
	keyedBatchCount: number;
	representedItemKeyCount: number;
	visibleItemKeyCount: number;
	candidateBatchCount: number;
	itemKeyMatchedBatchCount: number;
	unboundFallbackBatchCount: number;
	explicitFallbackBatchCount: number;
	queryFallbackBatchCount: number;
	fallbackReasonCount: number;
	fallbackReasonSamples: readonly string[];
	candidateCountsByCategory: Readonly<Record<LumaDrawCategory, number>>;
	visibleDrawCountsByCategory: Readonly<Record<LumaDrawCategory, number>>;
	fallbackCountsByCategory: Readonly<Record<LumaDrawCategory, number>>;
	representedItemKeyCountsByCategory: Readonly<Record<LumaDrawCategory, number>>;
}

interface LumaFrame {
	viewProjectionMatrix: LumaMat4;
	passes: LumaPass[];
	metrics: LumaFrameMetrics;
}

interface LumaBatchCandidateSelection {
	draws: LumaDraw[];
	metrics: LumaFrameMetrics;
}

const FALLBACK_REASON_SAMPLE_LIMIT = 8;

export function buildLumaFrame({
	assetState,
	batches,
	cameraFrame,
	renderChunkTransforms,
	staticRenderableScene,
	structuredInteriorScene,
	terrainScene,
}: {
	assetState: AssetChannelState;
	batches: readonly LumaWorldDrawBatch[];
	cameraFrame: SceneCameraFrame;
	renderChunkTransforms: readonly RenderChunkTransform[];
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	terrainScene: TerrainSceneModel;
}): LumaFrame {
	const viewProjectionMatrix = buildSceneCameraViewProjectionMatrix(cameraFrame);
	const visibilitySnapshot = derivePreparedBvhVisibilitySnapshot({
		assetState,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		renderChunkTransforms,
		frustum: buildRenderFrustumFromProjectionMatrix(viewProjectionMatrix),
	});
	const selection = selectLumaBatchCandidates(
		batches,
		{
			visibleItemKeys: visibilitySnapshot.visibleItemKeys,
			queryFallbackReasons: visibilitySnapshot.fallbackReasons,
		},
	);
	return {
		viewProjectionMatrix,
		passes: [{ id: "world", draws: selection.draws }],
		metrics: selection.metrics,
	};
}

export function buildRenderFrustumFromProjectionMatrix(
	matrix: LumaMat4,
): RenderFrustum {
	return {
		planes: [
			normalizePlane({
				normal: {
					x: matrix[3] + matrix[0],
					y: matrix[7] + matrix[4],
					z: matrix[11] + matrix[8],
				},
				constant: matrix[15] + matrix[12],
			}),
			normalizePlane({
				normal: {
					x: matrix[3] - matrix[0],
					y: matrix[7] - matrix[4],
					z: matrix[11] - matrix[8],
				},
				constant: matrix[15] - matrix[12],
			}),
			normalizePlane({
				normal: {
					x: matrix[3] + matrix[1],
					y: matrix[7] + matrix[5],
					z: matrix[11] + matrix[9],
				},
				constant: matrix[15] + matrix[13],
			}),
			normalizePlane({
				normal: {
					x: matrix[3] - matrix[1],
					y: matrix[7] - matrix[5],
					z: matrix[11] - matrix[9],
				},
				constant: matrix[15] - matrix[13],
			}),
			normalizePlane({
				normal: {
					x: matrix[3] + matrix[2],
					y: matrix[7] + matrix[6],
					z: matrix[11] + matrix[10],
				},
				constant: matrix[15] + matrix[14],
			}),
			normalizePlane({
				normal: {
					x: matrix[3] - matrix[2],
					y: matrix[7] - matrix[6],
					z: matrix[11] - matrix[10],
				},
				constant: matrix[15] - matrix[14],
			}),
		],
	};
}

function normalizePlane(plane: RenderPlane): RenderPlane {
	const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z);
	if (length === 0) {
		return plane;
	}
	return {
		normal: {
			x: plane.normal.x / length,
			y: plane.normal.y / length,
			z: plane.normal.z / length,
		},
		constant: plane.constant / length,
	};
}

function categorizeLumaBatch(batch: {
	id: string;
	kind: LumaWorldDrawBatchKind;
}): LumaDrawCategory {
	if (batch.id.startsWith("static-staged/")) {
		return "static-staged";
	}
	if (batch.kind === "terrain") {
		return "terrain";
	}
	if (batch.kind === "structured-interior") {
		return "structured-interior";
	}
	return "static";
}

function selectLumaBatchCandidates(
	batches: readonly LumaWorldDrawBatch[],
	options: {
		visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
		queryFallbackReasons: readonly string[];
	},
): LumaBatchCandidateSelection {
	const queryFallbackReasons = options.queryFallbackReasons;
	const hasQueryFallback = queryFallbackReasons.length > 0;
	const representedItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	const candidateCountsByCategory = createEmptyCategoryCounts();
	const visibleDrawCountsByCategory = createEmptyCategoryCounts();
	const fallbackCountsByCategory = createEmptyCategoryCounts();
	const representedItemKeyCountsByCategory = createEmptyCategoryCounts();
	let keyedBatchCount = 0;
	let itemKeyMatchedBatchCount = 0;
	let unboundFallbackBatchCount = 0;
	let explicitFallbackBatchCount = 0;
	let queryFallbackBatchCount = 0;
	const draws: LumaDraw[] = [];

	for (const batch of batches) {
		const category = categorizeLumaBatch(batch);
		const itemKeys = batch.bvhItemKeys;
		candidateCountsByCategory[category] += 1;
		for (const itemKey of itemKeys) {
			representedItemKeys.add(itemKey);
		}
		representedItemKeyCountsByCategory[category] += itemKeys.length;
		if (itemKeys.length > 0) {
			keyedBatchCount += 1;
		}

		const fallbackReason = resolveBatchFallbackReason({
			batchId: batch.id,
			fallbackReason: batch.bvhFallbackReason,
			hasItemKeys: itemKeys.length > 0,
			hasQueryFallback,
		});
		const itemKeyMatched =
			fallbackReason === null &&
			hasVisibleItemKey(itemKeys, options.visibleItemKeys);
		if (fallbackReason === null && !itemKeyMatched) {
			continue;
		}

		draws.push({ batchId: batch.id, category });
		visibleDrawCountsByCategory[category] += 1;
		if (itemKeyMatched) {
			itemKeyMatchedBatchCount += 1;
			continue;
		}
		if (fallbackReason === null) {
			throw new Error(
				`Luma batch ${batch.id} had neither a visible item key nor a fallback reason.`,
			);
		}
		fallbackReasons.push(fallbackReason);
		fallbackCountsByCategory[category] += 1;
		if (itemKeys.length === 0) {
			unboundFallbackBatchCount += 1;
		} else if (batch.bvhFallbackReason) {
			explicitFallbackBatchCount += 1;
		} else {
			queryFallbackBatchCount += 1;
		}
	}

	draws.sort(compareLumaDraws);
	return {
		draws,
		metrics: {
			registeredBatchCount: batches.length,
			keyedBatchCount,
			representedItemKeyCount: representedItemKeys.size,
			visibleItemKeyCount: options.visibleItemKeys.size,
			candidateBatchCount: draws.length,
			itemKeyMatchedBatchCount,
			unboundFallbackBatchCount,
			explicitFallbackBatchCount,
			queryFallbackBatchCount,
			fallbackReasonCount: fallbackReasons.length,
			fallbackReasonSamples: [...new Set(fallbackReasons)].slice(
				0,
				FALLBACK_REASON_SAMPLE_LIMIT,
			),
			candidateCountsByCategory,
			visibleDrawCountsByCategory,
			fallbackCountsByCategory,
			representedItemKeyCountsByCategory,
		},
	};
}

function hasVisibleItemKey(
	itemKeys: readonly RenderBvhItemKey[],
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>,
): boolean {
	for (const itemKey of itemKeys) {
		if (visibleItemKeys.has(itemKey)) {
			return true;
		}
	}
	return false;
}

function resolveBatchFallbackReason({
	batchId,
	fallbackReason,
	hasItemKeys,
	hasQueryFallback,
}: {
	batchId: string;
	fallbackReason: string | null;
	hasItemKeys: boolean;
	hasQueryFallback: boolean;
}): string | null {
	if (!hasItemKeys) {
		return (
			fallbackReason ?? `luma batch ${batchId} has no BVH item keys`
		);
	}
	if (fallbackReason) {
		return fallbackReason;
	}
	if (hasQueryFallback) {
		return `luma batch ${batchId} included because BVH query reported fallback data`;
	}
	return null;
}

function compareLumaDraws(left: LumaDraw, right: LumaDraw): number {
	return (
		compareCategory(left.category, right.category) ||
		left.batchId.localeCompare(right.batchId)
	);
}

function compareCategory(
	left: LumaDrawCategory,
	right: LumaDrawCategory,
): number {
	return categorySortRank(left) - categorySortRank(right);
}

function categorySortRank(category: LumaDrawCategory): number {
	switch (category) {
		case "terrain":
			return 0;
		case "structured-interior":
			return 1;
		case "static-staged":
			return 2;
		case "static":
			return 3;
		case "portal-mask":
			return 4;
		case "debug-overlay":
			return 5;
	}
}

function createEmptyCategoryCounts(): Record<LumaDrawCategory, number> {
	return {
		terrain: 0,
		"structured-interior": 0,
		"static-staged": 0,
		static: 0,
		"portal-mask": 0,
		"debug-overlay": 0,
	};
}
