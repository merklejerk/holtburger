import { Box3, Vector3 } from "three";

import type {
	AssetChannelState,
	PreparedBounds,
	PreparedEnvCellPayload,
	PreparedLandblockOutdoorPayload,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import {
	deriveTerrainTileRenderChunk,
	type RenderChunkPlacement,
} from "./render-chunks";
import {
	queryEnvCellLocalBvhVisibility,
	queryOutdoorBvhVisibility,
	queryTerrainBvhVisibility,
	type PreparedBvhVisibilityResult,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import type { RenderBounds, RenderFrustum } from "./render-spatial-math";
import { buildAcPlacementMatrix } from "./static-renderable-geometry";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

const FALLBACK_REASON_SAMPLE_LIMIT = 8;

export interface PreparedBvhDebugMetrics {
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

export function createEmptyPreparedBvhDebugMetrics(): PreparedBvhDebugMetrics {
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

export function derivePreparedBvhDebugMetrics(options: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	frustum: RenderFrustum;
	now?: () => number;
}): PreparedBvhDebugMetrics {
	const now = options.now ?? defaultNow;
	const startedAt = now();
	const metrics = createEmptyPreparedBvhDebugMetrics();
	const visibleItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	const chunkTransformsByKey = new Map(
		options.renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform,
		]),
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
			tile.renderChunk,
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
			deriveTerrainTileRenderChunk(payload.landblockId),
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

	for (const cell of options.structuredInteriorScene.cells) {
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
		metrics.envCellBvhConsideredCount += 1;
		metrics.envCellLocalBvhTotalItemCount += payload.localBvh.items.length;
		const transform = findChunkTransform(
			chunkTransformsByKey,
			cell.renderChunk,
			fallbackReasons,
		);
		if (!transform) {
			continue;
		}
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

	return metrics;
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

function transformEnvCellLocalBounds(
	bounds: PreparedBounds,
	payload: PreparedEnvCellPayload,
	transform: RenderChunkTransform,
): RenderBounds {
	const matrix = buildAcPlacementMatrix(
		payload.localPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const box = new Box3(
		new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
		new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
	).applyMatrix4(matrix);
	return {
		min: {
			x: box.min.x + transform.offset.x,
			y: box.min.y + transform.offset.y,
			z: box.min.z + transform.offset.z,
		},
		max: {
			x: box.max.x + transform.offset.x,
			y: box.max.y + transform.offset.y,
			z: box.max.z + transform.offset.z,
		},
	};
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
