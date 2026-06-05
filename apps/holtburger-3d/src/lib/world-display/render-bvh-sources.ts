import type {
	AssetChannelState,
	PreparedBounds,
	PreparedEnvCellBvhItem,
	PreparedEnvCellPayload,
	PreparedLandblockBvhNode,
	PreparedLandblockOutdoorPayload,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import type { SceneBoundsFrame } from "./camera";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import {
	envPortalBvhItemKey,
	envRenderGeometryBvhItemKey,
	envStaticBvhItemKey,
	outdoorStaticBvhItemKey,
	terrainBvhItemKey,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import {
	transformEnvCellLocalBounds,
	transformEnvCellLocalBoundsByPlacement,
	transformTerrainLocalBounds,
} from "./prepared-bvh-bounds";
import {
	getDetailedLandblockRenderArtifacts,
	type DetailedLandblockRenderArtifacts,
} from "./landblock-render-product";
import {
	renderBoundsContainedByFrustum,
	renderBoundsIntersectsFrustum,
	translateRenderBounds,
	type RenderBounds,
	type RenderFrustum,
} from "./render-spatial-math";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

export interface RenderSpaceBvhSource {
	sourceId: string;
	nodes: readonly RenderSpaceBvhNode[];
	itemKeys: readonly (RenderBvhItemKey | null)[];
}

interface RenderSpaceBvhNode {
	bounds: RenderBounds;
	left: number | null;
	right: number | null;
	itemIndices: readonly number[];
}

export interface PortalCompositeRenderBvhSources {
	terrainSources: readonly RenderSpaceBvhSource[];
	outdoorStaticSources: readonly RenderSpaceBvhSource[];
	envCellSourcesById: ReadonlyMap<number, RenderSpaceBvhSource>;
	fallbackReasons: readonly string[];
}

export interface RenderSpaceBvhQueryResult {
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
	fallbackReasons: readonly string[];
}

const RENDER_SPACE_BVH_SCENE_MINIMUM_SPAN = 180;

export function buildPortalCompositeRenderBvhSources(options: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	staticLandblockRenderArtifacts: StaticLandblockRenderArtifactStoreSnapshot;
	structuredInteriorScene: StructuredInteriorSceneModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
}): PortalCompositeRenderBvhSources {
	const fallbackReasons: string[] = [];
	const chunkTransformsByKey = new Map(
		options.renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform,
		]),
	);

	const terrainSources = options.terrainScene.tiles.flatMap((tile) => {
		const payload = findPreparedOutdoorPayload(
			options.assetState,
			tile.landblockId,
		);
		if (!payload) {
			fallbackReasons.push(
				`missing portal terrain payload ${formatLandblockOutdoorAssetId(tile.landblockId)}`,
			);
			return [];
		}
		const placement = deriveLandblockRenderChunkPlacement(tile.landblockId);
		const transform = chunkTransformsByKey.get(placement.chunkKey);
		if (!transform) {
			fallbackReasons.push(
				`missing portal render chunk transform ${placement.chunkKey}`,
			);
			return [];
		}
		return [
			buildRenderSpaceBvhSource({
				sourceId: `terrain:${placement.chunkKey}`,
				nodes: payload.terrain.terrainBvh.nodes,
				items: payload.terrain.terrainBvh.items,
				expectedCoordinateSpace: "landblock-outdoor-terrain-local",
				coordinateSpace: payload.terrain.terrainBvh.coordinateSpace,
				itemKey: (item) =>
					terrainBvhItemKey(payload.landblockId, item.quadIndex),
				boundsToRendererBounds: (bounds) =>
					transformTerrainLocalBounds(bounds, transform.offset),
				fallbackReasons,
			}),
		];
	});

	const outdoorStaticSources = findActiveOutdoorPayloads(
		options.assetState,
		options.staticRenderableScene,
	).flatMap((payload) => {
		const renderChunk = deriveLandblockRenderChunkPlacement(payload.landblockId);
		const transform = chunkTransformsByKey.get(renderChunk.chunkKey);
		if (!transform) {
			fallbackReasons.push(
				`missing portal render chunk transform ${renderChunk.chunkKey}`,
			);
			return [];
		}
		if (!payload.outdoorBvh) {
			fallbackReasons.push(
				`missing portal outdoor BVH ${formatLandblockOutdoorAssetId(payload.landblockId)}`,
			);
			return [];
		}
		return [
			buildRenderSpaceBvhSource({
				sourceId: `outdoor-static:${renderChunk.chunkKey}`,
				nodes: payload.outdoorBvh.nodes,
				items: payload.outdoorBvh.items,
				expectedCoordinateSpace: "landblock-render-local",
				coordinateSpace: payload.outdoorBvh.coordinateSpace,
				itemKey: (item) =>
					outdoorStaticBvhItemKey(payload.landblockId, item.instanceId),
				boundsToRendererBounds: (bounds) =>
					translateRenderBounds(bounds, transform.offset),
				fallbackReasons,
			}),
		];
	});

	const envCellSourcesById = collectDetailedArtifactEnvCellSourcesById({
		artifacts: options.staticLandblockRenderArtifacts,
		chunkTransformsByKey,
		fallbackReasons,
	});
	for (const cell of options.structuredInteriorScene.cells) {
		if (envCellSourcesById.has(cell.envCellId)) {
			continue;
		}
		const payload = findPreparedEnvCellPayload(
			options.assetState,
			cell.envCellId,
		);
		if (!payload) {
			fallbackReasons.push(
				`missing portal env-cell payload ${formatEnvCellAssetId(cell.envCellId)}`,
			);
			continue;
		}
		const transform = chunkTransformsByKey.get(cell.renderChunk.chunkKey);
		if (!transform) {
			fallbackReasons.push(
				`missing portal render chunk transform ${cell.renderChunk.chunkKey}`,
			);
			continue;
		}
		envCellSourcesById.set(
			cell.envCellId,
			buildRenderSpaceBvhSource({
				sourceId: `env-cell:${cell.renderKey}`,
				nodes: payload.localBvh.nodes,
				items: payload.localBvh.items,
				expectedCoordinateSpace: "env-cell-local",
				coordinateSpace: payload.localBvh.coordinateSpace,
				itemKey: (item) => envCellLocalItemKey(payload.envCellId, item),
				boundsToRendererBounds: (bounds) =>
					transformEnvCellLocalBounds(bounds, payload, transform),
				fallbackReasons,
			}),
		);
	}

	return {
		terrainSources,
		outdoorStaticSources,
		envCellSourcesById,
		fallbackReasons,
	};
}

function collectDetailedArtifactEnvCellSourcesById({
	artifacts,
	chunkTransformsByKey,
	fallbackReasons,
}: {
	artifacts: StaticLandblockRenderArtifactStoreSnapshot;
	chunkTransformsByKey: ReadonlyMap<string, RenderChunkTransform>;
	fallbackReasons: string[];
}): Map<number, RenderSpaceBvhSource> {
	const sourcesByEnvCellId = new Map<number, RenderSpaceBvhSource>();
	for (const result of artifacts.artifacts) {
		const detailed = getDetailedLandblockRenderArtifacts(result);
		if (!detailed) {
			continue;
		}
		const cellsByEnvCellId = new Map(
			detailed.structuredInteriorCells.map((cell) => [cell.envCellId, cell]),
		);
		for (const bvh of detailed.spatial.envCellLocalBvhs) {
			if (sourcesByEnvCellId.has(bvh.envCellId)) {
				continue;
			}
			const cell = cellsByEnvCellId.get(bvh.envCellId);
			if (!cell) {
				fallbackReasons.push(
					`missing portal artifact structured cell ${formatEnvCellAssetId(bvh.envCellId)}`,
				);
				continue;
			}
			const transform = chunkTransformsByKey.get(cell.renderChunk.chunkKey);
			if (!transform) {
				fallbackReasons.push(
					`missing portal render chunk transform ${cell.renderChunk.chunkKey}`,
				);
				continue;
			}
			sourcesByEnvCellId.set(
				bvh.envCellId,
				buildDetailedArtifactEnvCellSource({
					detailed,
					bvh,
					transform,
					fallbackReasons,
				}),
			);
		}
	}
	return sourcesByEnvCellId;
}

function buildDetailedArtifactEnvCellSource({
	detailed,
	bvh,
	transform,
	fallbackReasons,
}: {
	detailed: DetailedLandblockRenderArtifacts;
	bvh: DetailedLandblockRenderArtifacts["spatial"]["envCellLocalBvhs"][number];
	transform: RenderChunkTransform;
	fallbackReasons: string[];
}): RenderSpaceBvhSource {
	return buildRenderSpaceBvhSource({
		sourceId: `artifact-env-cell:${detailed.key}:${bvh.envCellId.toString(16)}`,
		nodes: bvh.localBvh.nodes,
		items: bvh.localBvh.items,
		expectedCoordinateSpace: "env-cell-local",
		coordinateSpace: bvh.localBvh.coordinateSpace,
		itemKey: (item) => envCellLocalItemKey(bvh.envCellId, item),
		boundsToRendererBounds: (bounds) =>
			transformEnvCellLocalBoundsByPlacement(
				bounds,
				bvh.localPlacement,
				transform,
			),
		fallbackReasons,
	});
}

export function calculateRenderSpaceBvhSourcesBoundsFrame(
	sources: PortalCompositeRenderBvhSources,
): SceneBoundsFrame | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	let sourceCount = 0;

	for (const source of allRenderSpaceBvhSources(sources)) {
		const root = source.nodes[0];
		if (!root) {
			continue;
		}
		minX = Math.min(minX, root.bounds.min.x);
		minY = Math.min(minY, root.bounds.min.y);
		minZ = Math.min(minZ, root.bounds.min.z);
		maxX = Math.max(maxX, root.bounds.max.x);
		maxY = Math.max(maxY, root.bounds.max.y);
		maxZ = Math.max(maxZ, root.bounds.max.z);
		sourceCount += 1;
	}

	if (sourceCount === 0) {
		return null;
	}

	return {
		center: {
			x: (minX + maxX) / 2,
			y: (minY + maxY) / 2,
			z: (minZ + maxZ) / 2,
		},
		size: {
			x: maxX - minX,
			y: maxY - minY,
			z: maxZ - minZ,
		},
		minimumSpan: RENDER_SPACE_BVH_SCENE_MINIMUM_SPAN,
	};
}

function* allRenderSpaceBvhSources(
	sources: PortalCompositeRenderBvhSources,
): Generator<RenderSpaceBvhSource> {
	yield* sources.terrainSources;
	yield* sources.outdoorStaticSources;
	yield* sources.envCellSourcesById.values();
}

export function queryRenderSpaceBvhSources(
	sources: Iterable<RenderSpaceBvhSource>,
	frustum: RenderFrustum,
): RenderSpaceBvhQueryResult {
	const visibleItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	for (const source of sources) {
		queryRenderSpaceBvhSource(
			source,
			frustum,
			visibleItemKeys,
			fallbackReasons,
		);
	}
	return { visibleItemKeys, fallbackReasons };
}

function buildRenderSpaceBvhSource<Item>(options: {
	sourceId: string;
	nodes: readonly PreparedLandblockBvhNode[];
	items: readonly Item[];
	expectedCoordinateSpace: string;
	coordinateSpace: string;
	itemKey: (item: Item) => RenderBvhItemKey | null;
	boundsToRendererBounds: (bounds: PreparedBounds) => RenderBounds;
	fallbackReasons: string[];
}): RenderSpaceBvhSource {
	if (options.coordinateSpace !== options.expectedCoordinateSpace) {
		options.fallbackReasons.push(
			`expected BVH coordinate space ${options.expectedCoordinateSpace}, got ${options.coordinateSpace}`,
		);
	}
	return {
		sourceId: options.sourceId,
		nodes: options.nodes.map((node) => ({
			bounds: options.boundsToRendererBounds(node.bounds),
			left: node.left,
			right: node.right,
			itemIndices: node.itemIndices,
		})),
		itemKeys: options.items.map(options.itemKey),
	};
}

function queryRenderSpaceBvhSource(
	source: RenderSpaceBvhSource,
	frustum: RenderFrustum,
	visibleItemKeys: Set<RenderBvhItemKey>,
	fallbackReasons: string[],
): void {
	const pendingNodeIndices = source.nodes.length === 0 ? [] : [0];
	const visitedNodeIndices = new Set<number>();
	while (pendingNodeIndices.length > 0) {
		const nodeIndex = pendingNodeIndices.pop();
		if (nodeIndex === undefined) {
			continue;
		}
		if (
			nodeIndex < 0 ||
			nodeIndex >= source.nodes.length ||
			visitedNodeIndices.has(nodeIndex)
		) {
			continue;
		}
		visitedNodeIndices.add(nodeIndex);
		const node = source.nodes[nodeIndex];
		if (!node || !renderBoundsIntersectsFrustum(node.bounds, frustum)) {
			continue;
		}
		if (renderBoundsContainedByFrustum(node.bounds, frustum)) {
			collectRenderSpaceBvhSubtreeItems({
				source,
				nodeIndex,
				visitedNodeIndices,
				visibleItemKeys,
				fallbackReasons,
			});
			continue;
		}
		collectRenderSpaceBvhNodeItems(
			source,
			node,
			visibleItemKeys,
			fallbackReasons,
		);
		if (node.left !== null) {
			pendingNodeIndices.push(node.left);
		}
		if (node.right !== null) {
			pendingNodeIndices.push(node.right);
		}
	}
}

function collectRenderSpaceBvhSubtreeItems({
	source,
	nodeIndex,
	visitedNodeIndices,
	visibleItemKeys,
	fallbackReasons,
}: {
	source: RenderSpaceBvhSource;
	nodeIndex: number;
	visitedNodeIndices: Set<number>;
	visibleItemKeys: Set<RenderBvhItemKey>;
	fallbackReasons: string[];
}): void {
	const pendingNodeIndices = [nodeIndex];
	while (pendingNodeIndices.length > 0) {
		const currentNodeIndex = pendingNodeIndices.pop();
		if (currentNodeIndex === undefined) {
			continue;
		}
		if (currentNodeIndex !== nodeIndex) {
			if (
				currentNodeIndex < 0 ||
				currentNodeIndex >= source.nodes.length ||
				visitedNodeIndices.has(currentNodeIndex)
			) {
				continue;
			}
			visitedNodeIndices.add(currentNodeIndex);
		}
		const node = source.nodes[currentNodeIndex];
		if (!node) {
			continue;
		}
		collectRenderSpaceBvhNodeItems(
			source,
			node,
			visibleItemKeys,
			fallbackReasons,
		);
		if (node.left !== null) {
			pendingNodeIndices.push(node.left);
		}
		if (node.right !== null) {
			pendingNodeIndices.push(node.right);
		}
	}
}

function collectRenderSpaceBvhNodeItems(
	source: RenderSpaceBvhSource,
	node: RenderSpaceBvhNode,
	visibleItemKeys: Set<RenderBvhItemKey>,
	fallbackReasons: string[],
): void {
	for (const itemIndex of node.itemIndices) {
		const itemKey = source.itemKeys[itemIndex];
		if (itemKey) {
			visibleItemKeys.add(itemKey);
		} else {
			fallbackReasons.push(
				`render-space BVH source ${source.sourceId} references missing item index ${itemIndex}`,
			);
		}
	}
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
