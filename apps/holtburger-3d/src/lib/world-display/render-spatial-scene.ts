import { Box3, Matrix4, Vector3 } from "three";

import type {
	AssetChannelState,
	PreparedLandblockPackPayload,
	PreparedLandblockSpatialItem,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import type {
	PortalDebugOverlay,
	WorldDebugOverlayModel,
} from "./debug-overlays";
import type {
	RenderBounds,
	RenderSpatialItem,
	RenderVec3,
} from "./render-spatial-index";
import {
	debugCellSpatialItemId,
	portalSpatialItemId,
	structuredCellSpatialItemId,
	terrainSpatialItemId,
} from "./render-spatial-ids";
import { buildAcPlacementMatrix } from "./static-renderable-geometry";
import {
	deriveTerrainTileRenderChunk,
	deriveRenderChunkKeyFromLandblockId,
	type RenderChunkPlacement,
	type RenderChunkKey,
} from "./render-chunks";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";

export const TERRAIN_SPATIAL_OWNER_KEY = "terrain-scene";
export const STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY =
	"structured-interior-scene";
export const DEBUG_OVERLAY_SPATIAL_OWNER_KEY = "debug-overlay-scene";
export const LANDBLOCK_PACK_SPATIAL_OWNER_KEY = "landblock-pack-scene";

const PORTAL_PICK_THICKNESS = 0.35;
const CELL_MARKER_PICK_RADIUS = 2.5;

export function deriveTerrainSpatialItems(
	terrainScene: TerrainSceneModel,
): RenderSpatialItem[] {
	return terrainScene.tiles.map(deriveTerrainSpatialItem);
}

export function deriveStructuredInteriorSpatialItems(
	structuredInteriorScene: StructuredInteriorSceneModel,
): RenderSpatialItem[] {
	return structuredInteriorScene.cells.map(deriveStructuredInteriorSpatialItem);
}

export function deriveDebugOverlaySpatialItems(
	debugOverlayScene: WorldDebugOverlayModel,
): RenderSpatialItem[] {
	return [
		...(debugOverlayScene.showCellIndicators
			? debugOverlayScene.cells.flatMap(deriveCellDebugOverlaySpatialItem)
			: []),
		...(debugOverlayScene.showPortalPolygons
			? debugOverlayScene.portals.flatMap(derivePortalSpatialItem)
			: []),
	];
}

export function deriveLandblockPackSpatialItems(
	assetState: AssetChannelState,
): RenderSpatialItem[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) =>
		asset.payload.kind === "landblock-pack"
			? derivePreparedPackSpatialItems(asset.payload)
			: [],
	);
}

export function deriveLandblockPackRenderChunkPlacements(
	assetState: AssetChannelState,
): RenderChunkPlacement[] {
	const chunksByKey = new Map<RenderChunkKey, RenderChunkPlacement>();
	for (const asset of Object.values(assetState.preparedByAssetId)) {
		if (asset.payload.kind !== "landblock-pack") {
			continue;
		}

		const chunk = deriveTerrainTileRenderChunk(asset.payload.landblockId);
		chunksByKey.set(chunk.chunkKey, chunk);
	}

	return [...chunksByKey.values()].sort((left, right) =>
		left.chunkKey.localeCompare(right.chunkKey),
	);
}

function deriveTerrainSpatialItem(tile: TerrainSceneTile): RenderSpatialItem {
	const bounds = deriveTerrainTileBounds(tile);
	return {
		id: terrainSpatialItemId(tile.assetId),
		kind: "terrain",
		ownerKey: TERRAIN_SPATIAL_OWNER_KEY,
		chunkKey: tile.renderChunk.chunkKey,
		broadphaseBounds: bounds,
		pickShape: { kind: "box", bounds },
		metadata: {
			kind: "terrain",
			landblockId: tile.landblockId,
			assetId: tile.assetId,
			terrainQuad: null,
		},
	};
}

function derivePreparedPackSpatialItems(
	pack: PreparedLandblockPackPayload,
): RenderSpatialItem[] {
	const chunkKey = deriveRenderChunkKeyFromLandblockId(pack.landblockId);
	return orderedPreparedPackSpatialItems(pack).map((item) =>
		derivePreparedPackSpatialItem(pack, item, chunkKey),
	);
}

function orderedPreparedPackSpatialItems(
	pack: PreparedLandblockPackPayload,
): PreparedLandblockSpatialItem[] {
	const bvh = pack.prepared.staticLandblockBvh;
	if (!bvh || bvh.nodes.length === 0) {
		return pack.prepared.spatialItems;
	}

	const orderedItemIndices = new Set<number>();
	collectPreparedPackBvhItemIndices(bvh.nodes, 0, orderedItemIndices);
	return [...orderedItemIndices]
		.map((index) => pack.prepared.spatialItems[index])
		.filter((item): item is PreparedLandblockSpatialItem => item !== undefined);
}

function collectPreparedPackBvhItemIndices(
	nodes: NonNullable<
		PreparedLandblockPackPayload["prepared"]["staticLandblockBvh"]
	>["nodes"],
	nodeIndex: number,
	itemIndices: Set<number>,
): void {
	const node = nodes[nodeIndex];
	if (!node) {
		return;
	}
	for (const itemIndex of node.itemIndices) {
		itemIndices.add(itemIndex);
	}
	if (node.left !== null) {
		collectPreparedPackBvhItemIndices(nodes, node.left, itemIndices);
	}
	if (node.right !== null) {
		collectPreparedPackBvhItemIndices(nodes, node.right, itemIndices);
	}
}

function derivePreparedPackSpatialItem(
	pack: PreparedLandblockPackPayload,
	item: PreparedLandblockSpatialItem,
	chunkKey: RenderChunkKey,
): RenderSpatialItem {
	const kind = renderSpatialKindForPackItem(item);
	return {
		id: `landblock-pack:${item.id}`,
		kind,
		ownerKey: LANDBLOCK_PACK_SPATIAL_OWNER_KEY,
		chunkKey,
		broadphaseBounds: item.bounds,
		pickShape: { kind: "box", bounds: item.bounds },
		metadata: derivePreparedPackSpatialMetadata(pack, item, kind),
	};
}

function renderSpatialKindForPackItem(
	item: PreparedLandblockSpatialItem,
): RenderSpatialItem["kind"] {
	switch (item.kind) {
		case "terrain":
			return "terrain";
		case "env-cell":
			return "structured-cell";
		case "portal":
			return "portal";
		case "building":
			return "building";
		case "indoor-static":
			return "indoor-static";
		case "outdoor-static":
			return "outdoor-static";
	}
}

function derivePreparedPackSpatialMetadata(
	pack: PreparedLandblockPackPayload,
	item: PreparedLandblockSpatialItem,
	kind: RenderSpatialItem["kind"],
): RenderSpatialItem["metadata"] {
	if (kind === "terrain") {
		const terrainQuad =
			item.metadata.kind === "terrain-quad"
				? {
						row: item.metadata.row,
						col: item.metadata.col,
						quadIndex: item.metadata.quadIndex,
						triangleIndices: item.metadata.triangleIndices,
					}
				: null;
		return {
			kind: "terrain",
			landblockId: pack.landblockId,
			assetId: item.id,
			terrainQuad,
		};
	}
	if (kind === "structured-cell") {
		return {
			kind: "structured-cell",
			envCellId: item.ownerId ?? pack.landblockId,
			renderKey: item.id,
			isFocus: false,
		};
	}
	if (kind === "portal") {
		return {
			kind: "portal",
			portalId: item.id,
			sourceEnvCellId: item.ownerId ?? pack.landblockId,
			targetEnvCellId: null,
			targetStatus: "unsupported",
			polygonId: 0,
			otherPortalId: 0,
			flags: 0,
		};
	}
	return {
		kind: "landblock-pack-spatial",
		spatialKind: kind,
		itemId: item.id,
		landblockId: pack.landblockId,
		ownerId: item.ownerId,
		sourceAssetId: item.sourceAssetId,
	};
}

function deriveStructuredInteriorSpatialItem(
	cell: StructuredInteriorCell,
): RenderSpatialItem {
	const transform = buildAcPlacementMatrix(
		cell.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const center = transformPoint({ x: 0, y: 0, z: 0 }, transform);
	const bounds = cell.renderGeometry.bounds
		? transformBounds(cell.renderGeometry.bounds, transform)
		: expandPointBounds(center, CELL_MARKER_PICK_RADIUS);

	return {
		id: structuredCellSpatialItemId(cell.renderKey),
		kind: "structured-cell",
		ownerKey: STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
		chunkKey: cell.renderChunk.chunkKey,
		broadphaseBounds: bounds,
		pickShape: cell.renderGeometry.bounds
			? { kind: "box", bounds }
			: { kind: "sphere", center, radius: CELL_MARKER_PICK_RADIUS },
		metadata: {
			kind: "structured-cell",
			envCellId: cell.envCellId,
			renderKey: cell.renderKey,
			isFocus: cell.isFocus,
		},
	};
}

function deriveCellDebugOverlaySpatialItem(
	cell: WorldDebugOverlayModel["cells"][number],
): RenderSpatialItem[] {
	if (!cell.bounds) {
		return [];
	}
	const transform = buildAcPlacementMatrix(
		cell.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const bounds = transformBounds(cell.bounds, transform);

	return [
		{
			id: debugCellSpatialItemId(cell.renderKey),
			kind: "structured-cell",
			ownerKey: DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			chunkKey: cell.renderChunk.chunkKey,
			broadphaseBounds: bounds,
			pickShape: { kind: "box", bounds },
			metadata: {
				kind: "structured-cell",
				envCellId: cell.envCellId,
				renderKey: cell.renderKey,
				isFocus: cell.isFocus,
			},
		},
	];
}

function derivePortalSpatialItem(
	portal: PortalDebugOverlay,
): RenderSpatialItem[] {
	if (portal.points.length < 3) {
		return [];
	}
	const transform = buildAcPlacementMatrix(
		portal.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const points = portal.points.map((point) => transformPoint(point, transform));
	const bounds = expandBounds(pointsToBounds(points), PORTAL_PICK_THICKNESS);
	return [
		{
			id: portalSpatialItemId(portal.portalId),
			kind: "portal",
			ownerKey: DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			chunkKey: portal.renderChunk.chunkKey,
			broadphaseBounds: bounds,
			pickShape: { kind: "polygon", points, thickness: PORTAL_PICK_THICKNESS },
			metadata: {
				kind: "portal",
				portalId: portal.portalId,
				sourceEnvCellId: portal.sourceEnvCellId,
				targetEnvCellId: portal.targetEnvCellId,
				targetStatus: portal.targetStatus,
				polygonId: portal.polygonId,
				otherPortalId: portal.otherPortalId,
				flags: portal.flags,
			},
		},
	];
}

function deriveTerrainTileBounds(tile: TerrainSceneTile): RenderBounds {
	const localBounds = pointsToBounds(
		tile.mesh.vertices.map((vertex) => ({
			x: vertex.x,
			y: vertex.z,
			z: -vertex.y,
		})),
	);
	return {
		min: {
			x: localBounds.min.x + tile.chunkLocalOffset.x,
			y: localBounds.min.y,
			z: localBounds.min.z + tile.chunkLocalOffset.z,
		},
		max: {
			x: localBounds.max.x + tile.chunkLocalOffset.x,
			y: localBounds.max.y,
			z: localBounds.max.z + tile.chunkLocalOffset.z,
		},
	};
}

function transformBounds(
	bounds: { min: Vec3Dto; max: Vec3Dto },
	matrix: Matrix4,
): RenderBounds {
	const box = new Box3(
		new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
		new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
	).applyMatrix4(matrix);
	return {
		min: vectorToRenderVec3(box.min),
		max: vectorToRenderVec3(box.max),
	};
}

function transformPoint(point: Vec3Dto, matrix: Matrix4): RenderVec3 {
	return vectorToRenderVec3(
		new Vector3(point.x, point.y, point.z).applyMatrix4(matrix),
	);
}

function pointsToBounds(points: RenderVec3[]): RenderBounds {
	if (points.length === 0) {
		throw new Error(
			"Cannot derive render spatial bounds for an empty point set.",
		);
	}
	const first = points[0];
	if (!first) {
		throw new Error(
			"Cannot derive render spatial bounds without a first point.",
		);
	}
	const bounds = {
		min: { ...first },
		max: { ...first },
	};
	for (const point of points.slice(1)) {
		bounds.min.x = Math.min(bounds.min.x, point.x);
		bounds.min.y = Math.min(bounds.min.y, point.y);
		bounds.min.z = Math.min(bounds.min.z, point.z);
		bounds.max.x = Math.max(bounds.max.x, point.x);
		bounds.max.y = Math.max(bounds.max.y, point.y);
		bounds.max.z = Math.max(bounds.max.z, point.z);
	}
	return bounds;
}

function expandPointBounds(point: RenderVec3, radius: number): RenderBounds {
	return {
		min: { x: point.x - radius, y: point.y - radius, z: point.z - radius },
		max: { x: point.x + radius, y: point.y + radius, z: point.z + radius },
	};
}

function expandBounds(bounds: RenderBounds, amount: number): RenderBounds {
	return {
		min: {
			x: bounds.min.x - amount,
			y: bounds.min.y - amount,
			z: bounds.min.z - amount,
		},
		max: {
			x: bounds.max.x + amount,
			y: bounds.max.y + amount,
			z: bounds.max.z + amount,
		},
	};
}

function vectorToRenderVec3(vector: Vector3): RenderVec3 {
	return { x: vector.x, y: vector.y, z: vector.z };
}
