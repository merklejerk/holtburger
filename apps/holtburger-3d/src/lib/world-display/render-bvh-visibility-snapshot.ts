import type {
	AssetChannelState,
	PreparedEnvCellPayload,
	PreparedLandblockOutdoorPayload,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import {
	deriveLandblockRenderChunkPlacement,
	type RenderChunkPlacement,
} from "./render-chunks";
import {
	queryEnvCellLocalBvhVisibility,
	queryEnvCellLocalBvhVisibilityByBvh,
	queryOutdoorBvhVisibility,
	queryTerrainBvhVisibility,
	type PreparedBvhVisibilityResult,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import {
	transformEnvCellLocalBounds,
	transformEnvCellLocalBoundsByPlacement,
} from "./prepared-bvh-bounds";
import {
	getDetailedLandblockRenderArtifacts,
	type DetailedLandblockRenderArtifacts,
} from "./landblock-render-product";
import type { RenderFrustum } from "./render-spatial-math";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

const FALLBACK_REASON_SAMPLE_LIMIT = 8;

export interface RenderBvhVisibilityMetrics {
	terrainBvhVisibleItemCount: number;
	terrainBvhTotalItemCount: number;
	outdoorStaticBvhVisibleItemCount: number;
	outdoorStaticBvhTotalItemCount: number;
	envCellLocalBvhVisibleItemCount: number;
	envCellLocalBvhTotalItemCount: number;
	visibleStaticInstanceKeyCount: number;
	visiblePortalKeyCount: number;
	envCellBvhConsideredCount: number;
	fallbackReasonCount: number;
	fallbackReasonSamples: string[];
	queryTimeMs: number;
}

export interface RenderBvhVisibilitySnapshot {
	metrics: RenderBvhVisibilityMetrics;
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
	fallbackReasons: readonly string[];
}

function createEmptyRenderBvhVisibilityMetrics(): RenderBvhVisibilityMetrics {
	return {
		terrainBvhVisibleItemCount: 0,
		terrainBvhTotalItemCount: 0,
		outdoorStaticBvhVisibleItemCount: 0,
		outdoorStaticBvhTotalItemCount: 0,
		envCellLocalBvhVisibleItemCount: 0,
		envCellLocalBvhTotalItemCount: 0,
		visibleStaticInstanceKeyCount: 0,
		visiblePortalKeyCount: 0,
		envCellBvhConsideredCount: 0,
		fallbackReasonCount: 0,
		fallbackReasonSamples: [],
		queryTimeMs: 0,
	};
}

export function deriveRenderBvhVisibilityMetrics(options: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	staticLandblockRenderProducts: StaticLandblockRenderProductSet;
	renderChunkTransforms: readonly RenderChunkTransform[];
	frustum: RenderFrustum;
	now?: () => number;
}): RenderBvhVisibilityMetrics {
	return deriveRenderBvhVisibilitySnapshot(options).metrics;
}

export function deriveRenderBvhVisibilitySnapshot(options: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	staticLandblockRenderProducts: StaticLandblockRenderProductSet;
	renderChunkTransforms: readonly RenderChunkTransform[];
	frustum: RenderFrustum;
	now?: () => number;
}): RenderBvhVisibilitySnapshot {
	const now = options.now ?? defaultNow;
	const startedAt = now();
	const metrics = createEmptyRenderBvhVisibilityMetrics();
	const visibleItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	const chunkTransformsByKey = new Map(
		options.renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform,
		]),
	);
	const artifactEnvCellBvhEntriesById = collectDetailedArtifactEnvCellBvhEntriesById(
		options.staticLandblockRenderProducts,
		fallbackReasons,
	);

	for (const tile of options.terrainScene.tiles) {
		const payload = findPreparedOutdoorPayload(
			options.assetState,
			tile.landblockId,
		);
		if (!payload) {
			fallbackReasons.push(
				`missing outdoor terrain payload ${formatLandblockOutdoorAssetId(tile.landblockId)}`,
			);
			continue;
		}
		metrics.terrainBvhTotalItemCount += payload.terrain.terrainBvh.items.length;
		const transform = findChunkTransform(
			chunkTransformsByKey,
			deriveLandblockRenderChunkPlacement(tile.landblockId),
			fallbackReasons,
		);
		if (!transform) {
			continue;
		}
		mergeVisibilityResult(
			queryTerrainBvhVisibility({
				terrainBvh: payload.terrain.terrainBvh,
				landblockId: payload.landblockId,
				frustum: options.frustum,
				chunkOffset: transform.offset,
			}),
			visibleItemKeys,
			fallbackReasons,
		);
	}

	for (const payload of findActiveOutdoorPayloads(
		options.assetState,
		options.staticRenderableScene,
	)) {
		metrics.outdoorStaticBvhTotalItemCount +=
			payload.outdoorBvh?.items.length ?? 0;
		const transform = findChunkTransform(
			chunkTransformsByKey,
			deriveLandblockRenderChunkPlacement(payload.landblockId),
			fallbackReasons,
		);
		if (!transform) {
			continue;
		}
		mergeVisibilityResult(
			queryOutdoorBvhVisibility({
				payload,
				frustum: options.frustum,
				chunkOffset: transform.offset,
			}),
			visibleItemKeys,
			fallbackReasons,
		);
	}

	for (const entry of artifactEnvCellBvhEntriesById.values()) {
		metrics.envCellBvhConsideredCount += 1;
		const transform = findChunkTransform(
			chunkTransformsByKey,
			entry.renderChunk,
			fallbackReasons,
		);
		if (!transform) {
			continue;
		}
		metrics.envCellLocalBvhTotalItemCount += entry.bvh.localBvh.items.length;
		mergeVisibilityResult(
			queryEnvCellLocalBvhVisibilityByBvh({
				envCellId: entry.bvh.envCellId,
				localBvh: entry.bvh.localBvh,
				frustum: options.frustum,
				boundsToRendererBounds: (bounds) =>
					transformEnvCellLocalBoundsByPlacement(
						bounds,
						entry.bvh.localPlacement,
						transform,
					),
			}),
			visibleItemKeys,
			fallbackReasons,
		);
	}

	for (const cell of options.structuredInteriorScene.cells) {
		if (artifactEnvCellBvhEntriesById.has(cell.envCellId)) {
			continue;
		}
		metrics.envCellBvhConsideredCount += 1;
		const transform = findChunkTransform(
			chunkTransformsByKey,
			cell.renderChunk,
			fallbackReasons,
		);
		if (!transform) {
			continue;
		}

		const payload = findPreparedEnvCellPayload(
			options.assetState,
			cell.envCellId,
		);
		if (!payload) {
			fallbackReasons.push(
				`missing env-cell payload ${formatEnvCellAssetId(cell.envCellId)}`,
			);
			continue;
		}
		metrics.envCellLocalBvhTotalItemCount += payload.localBvh.items.length;
		mergeVisibilityResult(
			queryEnvCellLocalBvhVisibility({
				payload,
				frustum: options.frustum,
				boundsToRendererBounds: (bounds) =>
					transformEnvCellLocalBounds(bounds, payload, transform),
			}),
			visibleItemKeys,
			fallbackReasons,
		);
	}

	metrics.terrainBvhVisibleItemCount = countKeysWithPrefix(
		visibleItemKeys,
		"terrain:",
	);
	metrics.outdoorStaticBvhVisibleItemCount = countKeysWithPrefix(
		visibleItemKeys,
		"outdoor-static:",
	);
	metrics.envCellLocalBvhVisibleItemCount =
		countKeysWithPrefix(visibleItemKeys, "env-render-geometry:") +
		countKeysWithPrefix(visibleItemKeys, "env-static:") +
		countKeysWithPrefix(visibleItemKeys, "env-portal:");
	metrics.visibleStaticInstanceKeyCount =
		countKeysWithPrefix(visibleItemKeys, "outdoor-static:") +
		countKeysWithPrefix(visibleItemKeys, "env-static:");
	metrics.visiblePortalKeyCount = countKeysWithPrefix(
		visibleItemKeys,
		"env-portal:",
	);
	metrics.fallbackReasonCount = fallbackReasons.length;
	metrics.fallbackReasonSamples = [...new Set(fallbackReasons)]
		.sort()
		.slice(0, FALLBACK_REASON_SAMPLE_LIMIT);
	metrics.queryTimeMs = Math.max(0, now() - startedAt);

	return {
		metrics,
		visibleItemKeys,
		fallbackReasons,
	};
}

interface DetailedArtifactEnvCellBvhEntry {
	bvh: DetailedLandblockRenderArtifacts["spatial"]["envCellLocalBvhs"][number];
	renderChunk: RenderChunkPlacement;
}

function collectDetailedArtifactEnvCellBvhEntriesById(
	artifacts: StaticLandblockRenderProductSet,
	fallbackReasons: string[],
): Map<number, DetailedArtifactEnvCellBvhEntry> {
	const entriesByEnvCellId = new Map<number, DetailedArtifactEnvCellBvhEntry>();
	for (const result of artifacts.artifacts) {
		const detailed = getDetailedLandblockRenderArtifacts(result);
		if (!detailed) {
			continue;
		}
		const cellsByEnvCellId = new Map(
			detailed.structuredInteriorCells.map((cell) => [cell.envCellId, cell]),
		);
		for (const bvh of detailed.spatial.envCellLocalBvhs) {
			if (entriesByEnvCellId.has(bvh.envCellId)) {
				continue;
			}
			const cell = cellsByEnvCellId.get(bvh.envCellId);
			if (!cell) {
				fallbackReasons.push(
					`missing artifact structured cell ${formatEnvCellAssetId(bvh.envCellId)}`,
				);
				continue;
			}
			entriesByEnvCellId.set(bvh.envCellId, {
				bvh,
				renderChunk: cell.renderChunk,
			});
		}
	}
	return entriesByEnvCellId;
}

function findActiveOutdoorPayloads(
	assetState: AssetChannelState,
	staticRenderableScene: StaticRenderableSceneModel,
): PreparedLandblockOutdoorPayload[] {
	const landblockIds = new Set(
		staticRenderableScene.sourceInstances
			.filter((instance) => instance.owningEnvCellId === null)
			.map((instance) => instance.owningLandblockId),
	);
	return [...landblockIds]
		.map((landblockId) => findPreparedOutdoorPayload(assetState, landblockId))
		.filter(
			(payload): payload is PreparedLandblockOutdoorPayload => payload !== null,
		)
		.sort((left, right) => left.landblockId - right.landblockId);
}

function findPreparedOutdoorPayload(
	assetState: AssetChannelState,
	landblockId: number,
): PreparedLandblockOutdoorPayload | null {
	const asset =
		assetState.preparedByAssetId[formatLandblockOutdoorAssetId(landblockId)];
	return asset?.payload.kind === "landblock-outdoor" ? asset.payload : null;
}

function findPreparedEnvCellPayload(
	assetState: AssetChannelState,
	envCellId: number,
): PreparedEnvCellPayload | null {
	const asset = assetState.preparedByAssetId[formatEnvCellAssetId(envCellId)];
	return asset?.payload.kind === "env-cell" &&
		asset.payload.envCellId === envCellId
		? asset.payload
		: null;
}

function findChunkTransform(
	chunkTransformsByKey: ReadonlyMap<string, RenderChunkTransform>,
	renderChunk: RenderChunkPlacement,
	fallbackReasons: string[],
): RenderChunkTransform | null {
	const transform = chunkTransformsByKey.get(renderChunk.chunkKey);
	if (!transform) {
		fallbackReasons.push(
			`missing render chunk transform ${renderChunk.chunkKey}`,
		);
		return null;
	}
	return transform;
}

function mergeVisibilityResult(
	result: PreparedBvhVisibilityResult,
	visibleItemKeys: Set<RenderBvhItemKey>,
	fallbackReasons: string[],
): void {
	for (const itemKey of result.visibleItemKeys) {
		visibleItemKeys.add(itemKey);
	}
	fallbackReasons.push(...result.fallbackReasons);
}

function countKeysWithPrefix(
	keys: ReadonlySet<RenderBvhItemKey>,
	prefix: string,
): number {
	let count = 0;
	for (const key of keys) {
		if (key.startsWith(prefix)) {
			count += 1;
		}
	}
	return count;
}

function defaultNow(): number {
	return globalThis.performance?.now() ?? Date.now();
}
