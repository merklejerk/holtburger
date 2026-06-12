import type { SceneCameraFrame } from "./camera";
import { buildSceneCameraViewProjectionMatrix, type RenderMat4 } from "./render-math";
import { deriveRenderBvhVisibilitySnapshot } from "./render-bvh-visibility-snapshot";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderFrustum, RenderPlane } from "./render-spatial-math";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

export const WORLD_RENDER_CATEGORY = {
	terrain: "terrain",
	structuredInterior: "structured-interior",
	static: "static",
	portalMask: "portal-mask",
	debugOverlay: "debug-overlay",
} as const;

type WorldRenderCategory =
	(typeof WORLD_RENDER_CATEGORY)[keyof typeof WORLD_RENDER_CATEGORY];

export const WORLD_RENDER_CANDIDATE_KIND = {
	terrainTile: "terrain-tile",
	staticBundleLayer: "static-bundle-layer",
	portalMask: "portal-mask",
} as const;

type WorldRenderCandidateKind =
	(typeof WORLD_RENDER_CANDIDATE_KIND)[keyof typeof WORLD_RENDER_CANDIDATE_KIND];

export const WORLD_RENDER_DRAW_KIND = {
	terrainTile: "terrain-tile",
	staticBundleLayer: "static-bundle-layer",
	transitionPortalMask: "transition-portal-mask",
} as const;

export const WORLD_RENDER_PASS_ID = {
	world: "world",
} as const;

type WorldRenderPassId =
	(typeof WORLD_RENDER_PASS_ID)[keyof typeof WORLD_RENDER_PASS_ID];

export interface WorldRenderCandidate {
	id: string;
	kind: WorldRenderCandidateKind;
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
}

export type WorldRenderDraw =
	| {
			kind: typeof WORLD_RENDER_DRAW_KIND.terrainTile;
			terrainTileId: string;
			category: typeof WORLD_RENDER_CATEGORY.terrain;
	  }
	| {
			kind: typeof WORLD_RENDER_DRAW_KIND.staticBundleLayer;
			staticBundleLayerId: string;
			category: typeof WORLD_RENDER_CATEGORY.static;
	  }
	| {
			kind: typeof WORLD_RENDER_DRAW_KIND.transitionPortalMask;
			transitionPortalMaskId: string;
			category: typeof WORLD_RENDER_CATEGORY.portalMask;
	  };

interface SelectedWorldRenderDraw {
	candidateId: string;
	draw: WorldRenderDraw;
	category: WorldRenderCategory;
}

interface WorldRenderPass {
	id: WorldRenderPassId;
	draws: WorldRenderDraw[];
}

export interface WorldRenderFrameMetrics {
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
	candidateCountsByCategory: Readonly<Record<WorldRenderCategory, number>>;
	visibleDrawCountsByCategory: Readonly<
		Record<WorldRenderCategory, number>
	>;
	fallbackCountsByCategory: Readonly<Record<WorldRenderCategory, number>>;
	representedItemKeyCountsByCategory: Readonly<
		Record<WorldRenderCategory, number>
	>;
}

export interface WorldRenderFrame {
	cameraFrame: SceneCameraFrame;
	viewProjectionMatrix: RenderMat4;
	passes: WorldRenderPass[];
	metrics: WorldRenderFrameMetrics;
}

interface WorldRenderCandidateSelection {
	draws: SelectedWorldRenderDraw[];
	metrics: WorldRenderFrameMetrics;
}

const FALLBACK_REASON_SAMPLE_LIMIT = 8;

const WORLD_RENDER_CATEGORY_BY_CANDIDATE_KIND: Readonly<
	Record<WorldRenderCandidateKind, WorldRenderCategory>
> = {
	[WORLD_RENDER_CANDIDATE_KIND.terrainTile]: WORLD_RENDER_CATEGORY.terrain,
	[WORLD_RENDER_CANDIDATE_KIND.staticBundleLayer]: WORLD_RENDER_CATEGORY.static,
	[WORLD_RENDER_CANDIDATE_KIND.portalMask]: WORLD_RENDER_CATEGORY.portalMask,
};

export function buildWorldRenderFrame({
	assetReadModel,
	candidates,
	cameraFrame,
	renderChunkTransforms,
	staticRenderableScene,
	staticLandblockRenderProducts,
	structuredInteriorScene,
	terrainScene,
}: {
	assetReadModel: RendererAssetReadModel;
	candidates: readonly WorldRenderCandidate[];
	cameraFrame: SceneCameraFrame;
	renderChunkTransforms: readonly RenderChunkTransform[];
	staticRenderableScene: StaticRenderableSceneModel;
	staticLandblockRenderProducts: StaticLandblockRenderProductSet;
	structuredInteriorScene: StructuredInteriorSceneModel;
	terrainScene: TerrainSceneModel;
}): WorldRenderFrame {
	const viewProjectionMatrix = buildSceneCameraViewProjectionMatrix(cameraFrame);
	const visibilitySnapshot = deriveRenderBvhVisibilitySnapshot({
		assetReadModel,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		staticLandblockRenderProducts,
		renderChunkTransforms,
		frustum: buildRenderFrustumFromProjectionMatrix(viewProjectionMatrix),
	});
	const selection = selectWorldRenderCandidates(
		candidates,
		{
			visibleItemKeys: visibilitySnapshot.visibleItemKeys,
			queryFallbackReasons: visibilitySnapshot.fallbackReasons,
		},
	);
	return {
		cameraFrame,
		viewProjectionMatrix,
		passes: [
			{
				id: WORLD_RENDER_PASS_ID.world,
				draws: selection.draws.map((draw) => draw.draw),
			},
		],
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

function categorizeWorldRenderCandidate(candidate: {
	id: string;
	kind: WorldRenderCandidateKind;
}): WorldRenderCategory {
	return WORLD_RENDER_CATEGORY_BY_CANDIDATE_KIND[candidate.kind];
}

function selectWorldRenderCandidates(
	candidates: readonly WorldRenderCandidate[],
	options: {
		visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
		queryFallbackReasons: readonly string[];
	},
): WorldRenderCandidateSelection {
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
	const draws: SelectedWorldRenderDraw[] = [];

	for (const candidate of candidates) {
		const category = categorizeWorldRenderCandidate(candidate);
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
			candidateId: candidate.id,
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

		draws.push({
			candidateId: candidate.id,
			draw: createWorldRenderDraw(candidate),
			category,
		});
		visibleDrawCountsByCategory[category] += 1;
		if (itemKeyMatched) {
			itemKeyMatchedBatchCount += 1;
			continue;
		}
		if (fallbackReason === null) {
			throw new Error(
				`World render candidate ${candidate.id} had neither a visible item key nor a fallback reason.`,
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

	draws.sort(compareWorldRenderDraws);
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
	candidateId,
	fallbackReason,
	hasItemKeys,
	hasQueryFallback,
}: {
	candidateId: string;
	fallbackReason: string | null;
	hasItemKeys: boolean;
	hasQueryFallback: boolean;
}): string | null {
	if (!hasItemKeys) {
		return (
			fallbackReason ?? `world render candidate ${candidateId} has no BVH item keys`
		);
	}
	if (fallbackReason) {
		return fallbackReason;
	}
	if (hasQueryFallback) {
		return `world render candidate ${candidateId} included because BVH query reported fallback data`;
	}
	return null;
}

function createWorldRenderDraw(candidate: WorldRenderCandidate): WorldRenderDraw {
	if (candidate.kind === WORLD_RENDER_CANDIDATE_KIND.terrainTile) {
		return {
			kind: WORLD_RENDER_DRAW_KIND.terrainTile,
			terrainTileId: candidate.id,
			category: WORLD_RENDER_CATEGORY.terrain,
		};
	}
	if (candidate.kind === WORLD_RENDER_CANDIDATE_KIND.staticBundleLayer) {
		return {
			kind: WORLD_RENDER_DRAW_KIND.staticBundleLayer,
			staticBundleLayerId: candidate.id,
			category: WORLD_RENDER_CATEGORY.static,
		};
	}
	if (candidate.kind === WORLD_RENDER_CANDIDATE_KIND.portalMask) {
		return {
			kind: WORLD_RENDER_DRAW_KIND.transitionPortalMask,
			transitionPortalMaskId: candidate.id,
			category: WORLD_RENDER_CATEGORY.portalMask,
		};
	}
	const exhaustive: never = candidate.kind;
	throw new Error(`Unsupported world render candidate kind ${exhaustive}.`);
}

function compareWorldRenderDraws(
	left: SelectedWorldRenderDraw,
	right: SelectedWorldRenderDraw,
): number {
	return (
		compareCategory(left.category, right.category) ||
		compareStableAsciiStrings(left.candidateId, right.candidateId)
	);
}

function compareStableAsciiStrings(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

function compareCategory(
	left: WorldRenderCategory,
	right: WorldRenderCategory,
): number {
	return categorySortRank(left) - categorySortRank(right);
}

function categorySortRank(category: WorldRenderCategory): number {
	switch (category) {
		case WORLD_RENDER_CATEGORY.terrain:
			return 0;
		case WORLD_RENDER_CATEGORY.structuredInterior:
			return 1;
		case WORLD_RENDER_CATEGORY.static:
			return 2;
		case WORLD_RENDER_CATEGORY.portalMask:
			return 3;
		case WORLD_RENDER_CATEGORY.debugOverlay:
			return 4;
	}
}

function createEmptyCategoryCounts(): Record<WorldRenderCategory, number> {
	return {
		[WORLD_RENDER_CATEGORY.terrain]: 0,
		[WORLD_RENDER_CATEGORY.structuredInterior]: 0,
		[WORLD_RENDER_CATEGORY.static]: 0,
		[WORLD_RENDER_CATEGORY.portalMask]: 0,
		[WORLD_RENDER_CATEGORY.debugOverlay]: 0,
	};
}
