import { Box3, Matrix4, Vector3 } from "three";

import type {
	PreparedPolygonSetBspNode,
	PreparedPolygonSetRenderGeometry,
	PreparedPolygonSetVertexArray,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import { buildAcPlacementMatrix } from "./static-renderable-geometry";
import {
	landblockRenderPointToCellAcLocalPoint,
	pointInsideCellBsp,
} from "./cell-bsp-residency";
import type { RenderChunkTransform } from "./render-anchor";
import type { WorldRenderSceneContext } from "./render-scene-context";
import type { StructuredInteriorCell } from "./structured-interior-scene";

export type CameraViewResidencyContext =
	| {
			kind: "outdoor-landblock";
			landblockId: number;
	  }
	| {
			kind: "env-cell";
			landblockId: number;
			envCellId: number;
	  }
	| {
			kind: "unknown";
			landblockId: number | null;
	  };

export interface WorldResidencyIndex {
	cellCount: number;
	landblockCount: number;
	query(position: Vec3Dto): CameraViewResidencyContext;
	queryDetailed(position: Vec3Dto): WorldResidencyQueryResult;
}

export interface WorldResidencyQueryResult {
	context: CameraViewResidencyContext;
	diagnostics: WorldResidencyQueryDiagnostics;
}

export interface WorldResidencyQueryDiagnostics {
	landblockId: number | null;
	aabbCandidateCount: number;
	cellBspMatchCount: number;
	aabbFallbackCount: number;
	source: "cell-bsp" | "aabb-fallback" | "outdoor" | "unknown";
}

interface ResidencyLandblockIndex {
	landblockId: number;
	chunkOffset: Vector3;
	root: ResidencyBvhNode | null;
	items: ResidencyCellItem[];
}

interface ResidencyBvhNode {
	bounds: Box3;
	left: ResidencyBvhNode | null;
	right: ResidencyBvhNode | null;
	items: ResidencyCellItem[];
}

interface ResidencyCellItem {
	envCellId: number;
	landblockId: number;
	bounds: Box3;
	center: Vector3;
	inverseCellRenderMatrix: Matrix4;
	cellBsp: PreparedPolygonSetBspNode | null;
}

interface RenderAnchorInference {
	landblockId: number;
}

export function createEmptyWorldResidencyIndex(): WorldResidencyIndex {
	return {
		cellCount: 0,
		landblockCount: 0,
		query: () => ({ kind: "unknown", landblockId: null }),
		queryDetailed: () => ({
			context: { kind: "unknown", landblockId: null },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: null,
				source: "unknown",
			}),
		}),
	};
}

export function buildWorldResidencyIndex(options: {
	cells: readonly StructuredInteriorCell[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	sceneContext?: WorldRenderSceneContext;
}): WorldResidencyIndex {
	const anchor = inferRenderAnchor(options.renderChunkTransforms);
	if (!anchor) {
		return createEmptyWorldResidencyIndex();
	}

	const chunkOffsetByLandblockId = deriveChunkOffsetByLandblockId(
		options.renderChunkTransforms,
	);
	const itemsByLandblockId = new Map<number, ResidencyCellItem[]>();
	for (const cell of options.cells) {
		const item = deriveResidencyCellItem(cell);
		if (!item) {
			continue;
		}

		const items = itemsByLandblockId.get(item.landblockId) ?? [];
		items.push(item);
		itemsByLandblockId.set(item.landblockId, items);
	}

	const landblocks = new Map<number, ResidencyLandblockIndex>();
	let cellCount = 0;
	for (const [landblockId, items] of itemsByLandblockId.entries()) {
		cellCount += items.length;
		landblocks.set(landblockId, {
			landblockId,
			chunkOffset:
				chunkOffsetByLandblockId.get(landblockId) ?? new Vector3(0, 0, 0),
			items,
			root: buildResidencyBvh(items),
		});
	}

	const sceneContext = options.sceneContext ?? {
		kind: "outdoor",
		anchorLandblockId: anchor.landblockId,
	};
	return {
		cellCount,
		landblockCount: landblocks.size,
		query: (position) =>
			queryWorldResidencyIndex(position, anchor, landblocks, sceneContext)
				.context,
		queryDetailed: (position) =>
			queryWorldResidencyIndex(position, anchor, landblocks, sceneContext),
	};
}

export function describeCameraViewResidencyContext(
	context: CameraViewResidencyContext,
): string {
	switch (context.kind) {
		case "outdoor-landblock":
			return `outdoor landblock ${formatResidencyHex(context.landblockId)}`;
		case "env-cell":
			return `env cell ${formatResidencyHex(context.envCellId)} in ${formatResidencyHex(context.landblockId)}`;
		case "unknown":
			return context.landblockId === null
				? "unknown"
				: `unknown in ${formatResidencyHex(context.landblockId)}`;
	}
}

export function inferRenderAnchor(
	transforms: readonly RenderChunkTransform[],
): RenderAnchorInference | null {
	const first = transforms[0];
	if (!first) {
		return null;
	}

	const chunkCoords = getOutdoorLandblockCoords(first.chunkLandblockId);
	const anchorX = chunkCoords.x - first.offset.x / OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const anchorY = chunkCoords.y + first.offset.z / OUTDOOR_LANDBLOCK_WORLD_SIZE;
	if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
		return null;
	}

	const roundedX = Math.round(anchorX);
	const roundedY = Math.round(anchorY);
	if (
		Math.abs(anchorX - roundedX) > 0.001 ||
		Math.abs(anchorY - roundedY) > 0.001 ||
		roundedX < 0 ||
		roundedX > 0xfe ||
		roundedY < 0 ||
		roundedY > 0xfe
	) {
		return null;
	}

	return {
		landblockId: makeOutdoorLandblockId(roundedX, roundedY),
	};
}

export function computeRendererPositionLandblockResidency(
	position: Vec3Dto,
	anchor: RenderAnchorInference,
): { landblockId: number; landblockRelativePosition: Vector3 } | null {
	const anchorCoords = getOutdoorLandblockCoords(anchor.landblockId);
	const globalOutdoorX =
		anchorCoords.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + position.x;
	const globalOutdoorY =
		anchorCoords.y * OUTDOOR_LANDBLOCK_WORLD_SIZE - position.z;
	const landblockX = Math.floor(globalOutdoorX / OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const landblockY = Math.floor(globalOutdoorY / OUTDOOR_LANDBLOCK_WORLD_SIZE);
	if (
		landblockX < 0 ||
		landblockX > 0xfe ||
		landblockY < 0 ||
		landblockY > 0xfe
	) {
		return null;
	}

	const landblockOriginX = landblockX * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const landblockOriginY = landblockY * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	return {
		landblockId: makeOutdoorLandblockId(landblockX, landblockY),
		landblockRelativePosition: new Vector3(
			globalOutdoorX - landblockOriginX,
			position.y,
			-(globalOutdoorY - landblockOriginY),
		),
	};
}

export function deriveResidencyCellBounds(
	cell: Pick<StructuredInteriorCell, "chunkLocalPlacement" | "renderGeometry">,
): Box3 | null {
	return transformRenderGeometryBounds(
		cell.renderGeometry,
		buildAcPlacementMatrix(
			cell.chunkLocalPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		),
	);
}

function queryWorldResidencyIndex(
	position: Vec3Dto,
	anchor: RenderAnchorInference,
	landblocks: ReadonlyMap<number, ResidencyLandblockIndex>,
	sceneContext: WorldRenderSceneContext,
): WorldResidencyQueryResult {
	if (sceneContext.kind === "dungeon") {
		return queryDungeonResidencyIndex(position, landblocks, sceneContext);
	}

	const landblockResidency = computeRendererPositionLandblockResidency(
		position,
		anchor,
	);
	if (!landblockResidency) {
		return {
			context: { kind: "unknown", landblockId: null },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: null,
				source: "unknown",
			}),
		};
	}

	const landblock = landblocks.get(landblockResidency.landblockId);
	if (!landblock) {
		return {
			context: {
				kind: "outdoor-landblock",
				landblockId: landblockResidency.landblockId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: landblockResidency.landblockId,
				source: "outdoor",
			}),
		};
	}

	const aabbCandidates = queryResidencyBvh(
		landblock.root,
		landblockResidency.landblockRelativePosition,
	);
	const cellBspMatches = filterCellBspMatches(
		aabbCandidates,
		landblockResidency.landblockRelativePosition,
	);
	const aabbFallbacks = filterAabbFallbackCandidates(aabbCandidates);
	const nearest = selectNearestResidencyCell(
		cellBspMatches,
		landblockResidency.landblockRelativePosition,
	);
	if (nearest) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearest.landblockId,
				envCellId: nearest.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearest.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "cell-bsp",
			}),
		};
	}

	const nearestFallback = selectNearestResidencyCell(
		aabbFallbacks,
		landblockResidency.landblockRelativePosition,
	);
	if (nearestFallback) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearestFallback.landblockId,
				envCellId: nearestFallback.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearestFallback.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "aabb-fallback",
			}),
		};
	}

	return {
		context: {
			kind: "outdoor-landblock",
			landblockId: landblock.landblockId,
		},
		diagnostics: createResidencyQueryDiagnostics({
			landblockId: landblock.landblockId,
			aabbCandidateCount: aabbCandidates.length,
			cellBspMatchCount: cellBspMatches.length,
			aabbFallbackCount: aabbFallbacks.length,
			source: "outdoor",
		}),
	};
}

function queryDungeonResidencyIndex(
	position: Vec3Dto,
	landblocks: ReadonlyMap<number, ResidencyLandblockIndex>,
	sceneContext: WorldRenderSceneContext,
): WorldResidencyQueryResult {
	const targetLandblockId =
		sceneContext.anchorLandblockId ?? firstLandblockId(landblocks);
	if (targetLandblockId === null) {
		return {
			context: { kind: "unknown", landblockId: null },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: null,
				source: "unknown",
			}),
		};
	}

	const landblock = landblocks.get(targetLandblockId);
	if (!landblock) {
		return {
			context: { kind: "unknown", landblockId: targetLandblockId },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: targetLandblockId,
				source: "unknown",
			}),
		};
	}

	const landblockRelativePosition = new Vector3(
		position.x - landblock.chunkOffset.x,
		position.y - landblock.chunkOffset.y,
		position.z - landblock.chunkOffset.z,
	);
	const aabbCandidates = queryResidencyBvh(
		landblock.root,
		landblockRelativePosition,
	);
	const cellBspMatches = filterCellBspMatches(
		aabbCandidates,
		landblockRelativePosition,
	);
	const aabbFallbacks = filterAabbFallbackCandidates(aabbCandidates);
	const nearest = selectNearestResidencyCell(
		cellBspMatches,
		landblockRelativePosition,
	);
	if (nearest) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearest.landblockId,
				envCellId: nearest.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearest.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "cell-bsp",
			}),
		};
	}

	const nearestFallback = selectNearestResidencyCell(
		aabbFallbacks,
		landblockRelativePosition,
	);
	if (nearestFallback) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearestFallback.landblockId,
				envCellId: nearestFallback.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearestFallback.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "aabb-fallback",
			}),
		};
	}

	return {
		context: { kind: "unknown", landblockId: landblock.landblockId },
		diagnostics: createResidencyQueryDiagnostics({
			landblockId: landblock.landblockId,
			aabbCandidateCount: aabbCandidates.length,
			cellBspMatchCount: cellBspMatches.length,
			aabbFallbackCount: aabbFallbacks.length,
			source: "unknown",
		}),
	};
}

function deriveResidencyCellItem(
	cell: StructuredInteriorCell,
): ResidencyCellItem | null {
	const cellRenderMatrix = buildAcPlacementMatrix(
		cell.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const bounds =
		(cell.cellStructure
			? deriveConservativeResidencyCellBounds(
					cell.cellStructure.vertexArray,
					cellRenderMatrix,
				)
			: null) ?? deriveResidencyCellBounds(cell);
	if (!bounds) {
		return null;
	}

	const center = new Vector3();
	bounds.getCenter(center);
	return {
		envCellId: cell.envCellId,
		landblockId: normalizeOutdoorLandblockId(cell.envCellId),
		bounds,
		center,
		inverseCellRenderMatrix: cellRenderMatrix.clone().invert(),
		cellBsp: cell.cellStructure?.cellBsp ?? null,
	};
}

export function deriveConservativeResidencyCellBounds(
	vertexArray: PreparedPolygonSetVertexArray,
	matrix: Matrix4,
): Box3 | null {
	if (vertexArray.vertices.length === 0) {
		return null;
	}

	const points = vertexArray.vertices.map((vertex) =>
		new Vector3(
			vertex.origin.x,
			vertex.origin.z,
			-vertex.origin.y,
		).applyMatrix4(matrix),
	);
	return new Box3().setFromPoints(points);
}

function filterCellBspMatches(
	items: readonly ResidencyCellItem[],
	landblockRelativePosition: Vector3,
): ResidencyCellItem[] {
	return items.filter((item) => {
		if (!item.cellBsp) {
			return false;
		}
		const cellLocalPoint = landblockRenderPointToCellAcLocalPoint(
			landblockRelativePosition,
			item.inverseCellRenderMatrix,
		);
		return pointInsideCellBsp(item.cellBsp, cellLocalPoint);
	});
}

function filterAabbFallbackCandidates(
	items: readonly ResidencyCellItem[],
): ResidencyCellItem[] {
	return items.filter((item) => !item.cellBsp);
}

function transformRenderGeometryBounds(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	matrix: Matrix4,
): Box3 | null {
	if (!renderGeometry.bounds) {
		return null;
	}

	const { min, max } = renderGeometry.bounds;
	const corners = [
		new Vector3(min.x, min.y, min.z),
		new Vector3(min.x, min.y, max.z),
		new Vector3(min.x, max.y, min.z),
		new Vector3(min.x, max.y, max.z),
		new Vector3(max.x, min.y, min.z),
		new Vector3(max.x, min.y, max.z),
		new Vector3(max.x, max.y, min.z),
		new Vector3(max.x, max.y, max.z),
	];
	return new Box3().setFromPoints(
		corners.map((corner) => corner.applyMatrix4(matrix)),
	);
}

function buildResidencyBvh(
	items: readonly ResidencyCellItem[],
): ResidencyBvhNode | null {
	if (items.length === 0) {
		return null;
	}

	const bounds = unionItemBounds(items);
	if (items.length <= 4) {
		return {
			bounds,
			left: null,
			right: null,
			items: [...items],
		};
	}

	const axis = longestBoxAxis(bounds);
	const sorted = [...items].sort(
		(left, right) =>
			left.center.getComponent(axis) - right.center.getComponent(axis),
	);
	const midpoint = Math.floor(sorted.length / 2);
	return {
		bounds,
		left: buildResidencyBvh(sorted.slice(0, midpoint)),
		right: buildResidencyBvh(sorted.slice(midpoint)),
		items: [],
	};
}

function queryResidencyBvh(
	node: ResidencyBvhNode | null,
	position: Vector3,
): ResidencyCellItem[] {
	if (!node || !node.bounds.containsPoint(position)) {
		return [];
	}
	if (!node.left && !node.right) {
		return node.items.filter((item) => item.bounds.containsPoint(position));
	}

	return [
		...queryResidencyBvh(node.left, position),
		...queryResidencyBvh(node.right, position),
	];
}

function selectNearestResidencyCell(
	items: readonly ResidencyCellItem[],
	position: Vector3,
): ResidencyCellItem | null {
	let nearest: ResidencyCellItem | null = null;
	let nearestDistanceSq = Number.POSITIVE_INFINITY;
	for (const item of items) {
		const distanceSq = item.center.distanceToSquared(position);
		if (
			distanceSq < nearestDistanceSq ||
			(distanceSq === nearestDistanceSq &&
				nearest !== null &&
				item.envCellId < nearest.envCellId)
		) {
			nearest = item;
			nearestDistanceSq = distanceSq;
		}
	}
	return nearest;
}

function unionItemBounds(items: readonly ResidencyCellItem[]): Box3 {
	const bounds = new Box3();
	for (const item of items) {
		bounds.union(item.bounds);
	}
	return bounds;
}

function longestBoxAxis(bounds: Box3): 0 | 1 | 2 {
	const size = new Vector3();
	bounds.getSize(size);
	if (size.x >= size.y && size.x >= size.z) {
		return 0;
	}
	return size.y >= size.z ? 1 : 2;
}

function formatResidencyHex(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function deriveChunkOffsetByLandblockId(
	transforms: readonly RenderChunkTransform[],
): Map<number, Vector3> {
	return new Map(
		transforms.map((transform) => [
			transform.chunkLandblockId,
			new Vector3(transform.offset.x, transform.offset.y, transform.offset.z),
		]),
	);
}

function firstLandblockId(
	landblocks: ReadonlyMap<number, ResidencyLandblockIndex>,
): number | null {
	const first = landblocks.keys().next();
	return first.done ? null : first.value;
}

function createResidencyQueryDiagnostics(options: {
	landblockId: number | null;
	aabbCandidateCount?: number;
	cellBspMatchCount?: number;
	aabbFallbackCount?: number;
	source: WorldResidencyQueryDiagnostics["source"];
}): WorldResidencyQueryDiagnostics {
	return {
		landblockId: options.landblockId,
		aabbCandidateCount: options.aabbCandidateCount ?? 0,
		cellBspMatchCount: options.cellBspMatchCount ?? 0,
		aabbFallbackCount: options.aabbFallbackCount ?? 0,
		source: options.source,
	};
}
