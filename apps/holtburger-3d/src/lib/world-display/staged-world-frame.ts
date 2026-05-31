import type { AssetChannelState } from "../assets/types";
import type { SceneCameraFrame } from "./camera";
import { buildSceneCameraViewProjectionMatrix, type RenderMat4 } from "./render-math";
import { derivePreparedBvhVisibilitySnapshot } from "./prepared-bvh-metrics";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderFrustum, RenderPlane } from "./render-spatial-math";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

export type StagedWorldDrawUnitCategory =
	| "terrain"
	| "structured-interior"
	| "static-staged"
	| "static"
	| "portal-mask"
	| "debug-overlay";

export type StagedWorldDrawUnitKind =
	| "terrain"
	| "structured-interior"
	| "static"
	| "portal-mask";

export interface StagedWorldFrameCandidate {
	id: string;
	kind: StagedWorldDrawUnitKind;
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
}

export interface StagedWorldDraw {
	drawUnitId: string;
	category: StagedWorldDrawUnitCategory;
}

export interface StagedWorldPass {
	id: "world";
	draws: StagedWorldDraw[];
}

export interface StagedWorldFrameMetrics {
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
	candidateCountsByCategory: Readonly<Record<StagedWorldDrawUnitCategory, number>>;
	visibleDrawCountsByCategory: Readonly<
		Record<StagedWorldDrawUnitCategory, number>
	>;
	fallbackCountsByCategory: Readonly<Record<StagedWorldDrawUnitCategory, number>>;
	representedItemKeyCountsByCategory: Readonly<
		Record<StagedWorldDrawUnitCategory, number>
	>;
}

export interface StagedWorldFrame {
	cameraFrame: SceneCameraFrame;
	viewProjectionMatrix: RenderMat4;
	passes: StagedWorldPass[];
	metrics: StagedWorldFrameMetrics;
}

interface StagedWorldCandidateSelection {
	draws: StagedWorldDraw[];
	metrics: StagedWorldFrameMetrics;
}

const FALLBACK_REASON_SAMPLE_LIMIT = 8;

export function buildStagedWorldFrame({
	assetState,
	candidates,
	cameraFrame,
	renderChunkTransforms,
	staticRenderableScene,
	structuredInteriorScene,
	terrainScene,
}: {
	assetState: AssetChannelState;
	candidates: readonly StagedWorldFrameCandidate[];
	cameraFrame: SceneCameraFrame;
	renderChunkTransforms: readonly RenderChunkTransform[];
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	terrainScene: TerrainSceneModel;
}): StagedWorldFrame {
	const viewProjectionMatrix = buildSceneCameraViewProjectionMatrix(cameraFrame);
	const visibilitySnapshot = derivePreparedBvhVisibilitySnapshot({
		assetState,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		renderChunkTransforms,
		frustum: buildRenderFrustumFromProjectionMatrix(viewProjectionMatrix),
	});
	const selection = selectStagedWorldCandidates(
		candidates,
		{
			visibleItemKeys: visibilitySnapshot.visibleItemKeys,
			queryFallbackReasons: visibilitySnapshot.fallbackReasons,
		},
	);
	return {
		cameraFrame,
		viewProjectionMatrix,
		passes: [{ id: "world", draws: selection.draws }],
		metrics: selection.metrics,
	};
}

export function buildRenderFrustumFromProjectionMatrix(
	matrix: RenderMat4,
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

function categorizeStagedWorldCandidate(candidate: {
	id: string;
	kind: StagedWorldDrawUnitKind;
}): StagedWorldDrawUnitCategory {
	if (candidate.id.startsWith("static-staged/")) {
		return "static-staged";
	}
	if (candidate.kind === "terrain") {
		return "terrain";
	}
	if (candidate.kind === "portal-mask") {
		return "portal-mask";
	}
	if (candidate.kind === "structured-interior") {
		return "structured-interior";
	}
	return "static";
}

function selectStagedWorldCandidates(
	candidates: readonly StagedWorldFrameCandidate[],
	options: {
		visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
		queryFallbackReasons: readonly string[];
	},
): StagedWorldCandidateSelection {
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
	const draws: StagedWorldDraw[] = [];

	for (const candidate of candidates) {
		const category = categorizeStagedWorldCandidate(candidate);
		const itemKeys = candidate.bvhItemKeys;
		candidateCountsByCategory[category] += 1;
		for (const itemKey of itemKeys) {
			representedItemKeys.add(itemKey);
		}
		representedItemKeyCountsByCategory[category] += itemKeys.length;
		if (itemKeys.length > 0) {
			keyedBatchCount += 1;
		}

		const fallbackReason = resolveBatchFallbackReason({
			drawUnitId: candidate.id,
			fallbackReason: candidate.bvhFallbackReason,
			hasItemKeys: itemKeys.length > 0,
			hasQueryFallback,
		});
		const itemKeyMatched =
			fallbackReason === null &&
			hasVisibleItemKey(itemKeys, options.visibleItemKeys);
		if (fallbackReason === null && !itemKeyMatched) {
			continue;
		}

		draws.push({ drawUnitId: candidate.id, category });
		visibleDrawCountsByCategory[category] += 1;
		if (itemKeyMatched) {
			itemKeyMatchedBatchCount += 1;
			continue;
		}
		if (fallbackReason === null) {
			throw new Error(
				`Staged draw unit ${candidate.id} had neither a visible item key nor a fallback reason.`,
			);
		}
		fallbackReasons.push(fallbackReason);
		fallbackCountsByCategory[category] += 1;
		if (itemKeys.length === 0) {
			unboundFallbackBatchCount += 1;
		} else if (candidate.bvhFallbackReason) {
			explicitFallbackBatchCount += 1;
		} else {
			queryFallbackBatchCount += 1;
		}
	}

	draws.sort(compareStagedWorldDraws);
	return {
		draws,
		metrics: {
			registeredBatchCount: candidates.length,
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
	drawUnitId,
	fallbackReason,
	hasItemKeys,
	hasQueryFallback,
}: {
	drawUnitId: string;
	fallbackReason: string | null;
	hasItemKeys: boolean;
	hasQueryFallback: boolean;
}): string | null {
	if (!hasItemKeys) {
		return (
			fallbackReason ?? `staged draw unit ${drawUnitId} has no BVH item keys`
		);
	}
	if (fallbackReason) {
		return fallbackReason;
	}
	if (hasQueryFallback) {
		return `staged draw unit ${drawUnitId} included because BVH query reported fallback data`;
	}
	return null;
}

function compareStagedWorldDraws(
	left: StagedWorldDraw,
	right: StagedWorldDraw,
): number {
	return (
		compareCategory(left.category, right.category) ||
		left.drawUnitId.localeCompare(right.drawUnitId)
	);
}

function compareCategory(
	left: StagedWorldDrawUnitCategory,
	right: StagedWorldDrawUnitCategory,
): number {
	return categorySortRank(left) - categorySortRank(right);
}

function categorySortRank(category: StagedWorldDrawUnitCategory): number {
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

function createEmptyCategoryCounts(): Record<StagedWorldDrawUnitCategory, number> {
	return {
		terrain: 0,
		"structured-interior": 0,
		"static-staged": 0,
		static: 0,
		"portal-mask": 0,
		"debug-overlay": 0,
	};
}
