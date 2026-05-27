import type {
	PreparedBounds,
	PreparedEnvCellBvhItem,
	PreparedEnvCellPayload,
	PreparedLandblockBvhNode,
	PreparedLandblockOutdoorPayload,
	PreparedLandblockTopologyPayload,
	PreparedOutdoorBvhItem,
	PreparedTerrainBvh,
	PreparedTerrainBvhItem,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	renderBoundsIntersectsFrustum,
	translateRenderBounds,
	type RenderBounds,
	type RenderFrustum,
	type RenderVec3,
} from "./render-spatial-math";

export type RenderBvhItemKey =
	| `terrain:landblock:${string}:quad:${number}`
	| `outdoor-static:landblock:${string}:instance:${string}`
	| `env-static:cell:${string}:instance:${string}`
	| `env-render-geometry:cell:${string}`
	| `env-portal:cell:${string}:portal:${string}`
	| `residency-cell:cell:${string}`;

export interface PreparedBvhQueryCounters {
	nodesVisited: number;
	nodesIntersected: number;
	itemIndicesVisited: number;
	visibleItems: number;
	invalidItemIndices: number;
}

export interface PreparedBvhVisibilityResult {
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
	counters: PreparedBvhQueryCounters;
	fallbackReasons: readonly string[];
}

export interface EnvCellResidencyVisibilityResult extends PreparedBvhVisibilityResult {
	visibleEnvCellIds: ReadonlySet<number>;
}

export interface LoadedEnvCellBvhVisibilityResult extends PreparedBvhVisibilityResult {
	consideredEnvCellIds: readonly number[];
	missingEnvCellIds: readonly number[];
}

interface PreparedBvhLike<Item> {
	coordinateSpace: string;
	nodes: PreparedLandblockBvhNode[];
	items: Item[];
}

interface QueryPreparedBvhOptions<Item> {
	bvh: PreparedBvhLike<Item> | null;
	expectedCoordinateSpace: string;
	frustum: RenderFrustum;
	itemKey: (item: Item) => RenderBvhItemKey | null;
	boundsToRendererBounds: (bounds: PreparedBounds) => RenderBounds;
	missingBvhReason: string;
}

export function terrainBvhItemKey(
	landblockId: number,
	quadIndex: number,
): RenderBvhItemKey {
	return `terrain:landblock:${formatHex32(landblockId)}:quad:${quadIndex}`;
}

export function outdoorStaticBvhItemKey(
	sourceLandblockId: number,
	instanceId: string,
): RenderBvhItemKey {
	return `outdoor-static:landblock:${formatHex32(sourceLandblockId)}:instance:${instanceId}`;
}

export function envStaticBvhItemKey(
	envCellId: number,
	instanceId: string,
): RenderBvhItemKey {
	return `env-static:cell:${formatHex32(envCellId)}:instance:${instanceId}`;
}

export function envRenderGeometryBvhItemKey(
	envCellId: number,
): RenderBvhItemKey {
	return `env-render-geometry:cell:${formatHex32(envCellId)}`;
}

export function envPortalBvhItemKey(
	envCellId: number,
	portalId: string,
): RenderBvhItemKey {
	return `env-portal:cell:${formatHex32(envCellId)}:portal:${portalId}`;
}

export function residencyCellBvhItemKey(envCellId: number): RenderBvhItemKey {
	return `residency-cell:cell:${formatHex32(envCellId)}`;
}

export function queryTerrainBvhVisibility(options: {
	terrainBvh: PreparedTerrainBvh;
	landblockId: number;
	frustum: RenderFrustum;
	chunkOffset: RenderVec3;
}): PreparedBvhVisibilityResult {
	return queryPreparedBvh<PreparedTerrainBvhItem>({
		bvh: options.terrainBvh,
		expectedCoordinateSpace: "landblock-outdoor-terrain-local",
		frustum: options.frustum,
		itemKey: (item) => terrainBvhItemKey(options.landblockId, item.quadIndex),
		boundsToRendererBounds: (bounds) =>
			translateRenderBounds(terrainLocalBoundsToRenderBounds(bounds), options.chunkOffset),
		missingBvhReason: "missing terrain BVH",
	});
}

export function queryOutdoorBvhVisibility(options: {
	payload: PreparedLandblockOutdoorPayload;
	frustum: RenderFrustum;
	chunkOffset: RenderVec3;
}): PreparedBvhVisibilityResult {
	return queryPreparedBvh<PreparedOutdoorBvhItem>({
		bvh: options.payload.outdoorBvh,
		expectedCoordinateSpace: "landblock-render-local",
		frustum: options.frustum,
		itemKey: (item) =>
			outdoorStaticBvhItemKey(options.payload.landblockId, item.instanceId),
		boundsToRendererBounds: translatePreparedBoundsByOffset(
			options.chunkOffset,
		),
		missingBvhReason: "missing outdoor BVH",
	});
}

export function queryEnvCellResidencyBvhVisibility(options: {
	topology: PreparedLandblockTopologyPayload;
	frustum: RenderFrustum;
	chunkOffset: RenderVec3;
}): EnvCellResidencyVisibilityResult {
	const visibleEnvCellIds = new Set<number>();
	const result = queryPreparedBvh({
		bvh: options.topology.envCellResidencyBvh,
		expectedCoordinateSpace: "landblock-topology-residency",
		frustum: options.frustum,
		itemKey: (item) => {
			visibleEnvCellIds.add(item.envCellId);
			return residencyCellBvhItemKey(item.envCellId);
		},
		boundsToRendererBounds: translatePreparedBoundsByOffset(
			options.chunkOffset,
		),
		missingBvhReason: "missing env-cell residency BVH",
	});

	return {
		...result,
		visibleEnvCellIds,
	};
}

export function queryEnvCellLocalBvhVisibility(options: {
	payload: PreparedEnvCellPayload;
	frustum: RenderFrustum;
	boundsToRendererBounds: (bounds: PreparedBounds) => RenderBounds;
}): PreparedBvhVisibilityResult {
	return queryPreparedBvh<PreparedEnvCellBvhItem>({
		bvh: options.payload.localBvh,
		expectedCoordinateSpace: "env-cell-local",
		frustum: options.frustum,
		itemKey: (item) => envCellLocalItemKey(options.payload.envCellId, item),
		boundsToRendererBounds: options.boundsToRendererBounds,
		missingBvhReason: "missing env-cell local BVH",
	});
}

export function queryLoadedEnvCellBvhVisibility(options: {
	topology: PreparedLandblockTopologyPayload;
	loadedEnvCellsById: ReadonlyMap<number, PreparedEnvCellPayload>;
	frustum: RenderFrustum;
	topologyChunkOffset: RenderVec3;
	envCellBoundsToRendererBounds: (
		envCell: PreparedEnvCellPayload,
		bounds: PreparedBounds,
	) => RenderBounds;
}): LoadedEnvCellBvhVisibilityResult {
	const residencyResult = queryEnvCellResidencyBvhVisibility({
		topology: options.topology,
		frustum: options.frustum,
		chunkOffset: options.topologyChunkOffset,
	});
	const visibleItemKeys = new Set(residencyResult.visibleItemKeys);
	const counters = { ...residencyResult.counters };
	const fallbackReasons = [...residencyResult.fallbackReasons];
	const consideredEnvCellIds = [...residencyResult.visibleEnvCellIds].sort(
		(left, right) => left - right,
	);
	const missingEnvCellIds: number[] = [];

	for (const envCellId of consideredEnvCellIds) {
		const envCell = options.loadedEnvCellsById.get(envCellId);
		if (!envCell) {
			missingEnvCellIds.push(envCellId);
			fallbackReasons.push(
				`missing loaded env-cell payload ${formatHex32(envCellId)}`,
			);
			continue;
		}

		const localResult = queryEnvCellLocalBvhVisibility({
			payload: envCell,
			frustum: options.frustum,
			boundsToRendererBounds: (bounds) =>
				options.envCellBoundsToRendererBounds(envCell, bounds),
		});
		for (const itemKey of localResult.visibleItemKeys) {
			visibleItemKeys.add(itemKey);
		}
		addCounters(counters, localResult.counters);
		fallbackReasons.push(...localResult.fallbackReasons);
	}

	return {
		visibleItemKeys,
		counters,
		fallbackReasons,
		consideredEnvCellIds,
		missingEnvCellIds,
	};
}

function queryPreparedBvh<Item>(
	options: QueryPreparedBvhOptions<Item>,
): PreparedBvhVisibilityResult {
	const visibleItemKeys = new Set<RenderBvhItemKey>();
	const counters = createEmptyCounters();
	const fallbackReasons: string[] = [];
	const bvh = options.bvh;
	if (!bvh) {
		fallbackReasons.push(options.missingBvhReason);
		return { visibleItemKeys, counters, fallbackReasons };
	}
	if (bvh.coordinateSpace !== options.expectedCoordinateSpace) {
		fallbackReasons.push(
			`expected BVH coordinate space ${options.expectedCoordinateSpace}, got ${bvh.coordinateSpace}`,
		);
		return { visibleItemKeys, counters, fallbackReasons };
	}

	const pendingNodeIndices = bvh.nodes.length === 0 ? [] : [0];
	const visitedNodeIndices = new Set<number>();
	while (pendingNodeIndices.length > 0) {
		const nodeIndex = pendingNodeIndices.pop();
		if (nodeIndex === undefined) {
			continue;
		}
		if (
			nodeIndex < 0 ||
			nodeIndex >= bvh.nodes.length ||
			visitedNodeIndices.has(nodeIndex)
		) {
			continue;
		}
		visitedNodeIndices.add(nodeIndex);
		const node = bvh.nodes[nodeIndex];
		if (!node) {
			continue;
		}
		counters.nodesVisited += 1;
		if (
			!renderBoundsIntersectsFrustum(
				options.boundsToRendererBounds(node.bounds),
				options.frustum,
			)
		) {
			continue;
		}
		counters.nodesIntersected += 1;

		for (const itemIndex of node.itemIndices) {
			counters.itemIndicesVisited += 1;
			const item = bvh.items[itemIndex];
			if (!item) {
				counters.invalidItemIndices += 1;
				fallbackReasons.push(`BVH references missing item index ${itemIndex}`);
				continue;
			}
			const itemKey = options.itemKey(item);
			if (itemKey) {
				visibleItemKeys.add(itemKey);
				counters.visibleItems += 1;
			}
		}
		if (node.left !== null) {
			pendingNodeIndices.push(node.left);
		}
		if (node.right !== null) {
			pendingNodeIndices.push(node.right);
		}
	}

	return { visibleItemKeys, counters, fallbackReasons };
}

function envCellLocalItemKey(
	envCellId: number,
	item: PreparedEnvCellBvhItem,
): RenderBvhItemKey {
	if (item.kind === "render-geometry") {
		return envRenderGeometryBvhItemKey(envCellId);
	}
	if (item.kind === "static") {
		return envStaticBvhItemKey(envCellId, item.instanceId);
	}
	return envPortalBvhItemKey(envCellId, item.portalId);
}

function translatePreparedBoundsByOffset(
	offset: RenderVec3,
): (bounds: PreparedBounds) => RenderBounds {
	return (bounds) => translateRenderBounds(bounds, offset);
}

function terrainLocalBoundsToRenderBounds(bounds: PreparedBounds): RenderBounds {
	return {
		min: {
			x: bounds.min.x,
			y: bounds.min.z,
			z: -bounds.max.y,
		},
		max: {
			x: bounds.max.x,
			y: bounds.max.z,
			z: -bounds.min.y,
		},
	};
}

function createEmptyCounters(): PreparedBvhQueryCounters {
	return {
		nodesVisited: 0,
		nodesIntersected: 0,
		itemIndicesVisited: 0,
		visibleItems: 0,
		invalidItemIndices: 0,
	};
}

function addCounters(
	target: PreparedBvhQueryCounters,
	source: PreparedBvhQueryCounters,
): void {
	target.nodesVisited += source.nodesVisited;
	target.nodesIntersected += source.nodesIntersected;
	target.itemIndicesVisited += source.itemIndicesVisited;
	target.visibleItems += source.visibleItems;
	target.invalidItemIndices += source.invalidItemIndices;
}
