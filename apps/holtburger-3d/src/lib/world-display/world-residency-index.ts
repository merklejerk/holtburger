import { Box3, Matrix4, Vector3 } from "three";

import type { PreparedPolygonSetRenderGeometry } from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import { buildAcPlacementMatrix } from "./static-renderable-geometry";
import type { RenderChunkTransform } from "./render-anchor";
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
}

interface ResidencyLandblockIndex {
	landblockId: number;
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
}

interface RenderAnchorInference {
	landblockId: number;
}

export function createEmptyWorldResidencyIndex(): WorldResidencyIndex {
	return {
		cellCount: 0,
		landblockCount: 0,
		query: () => ({ kind: "unknown", landblockId: null }),
	};
}

export function buildWorldResidencyIndex(options: {
	cells: readonly StructuredInteriorCell[];
	renderChunkTransforms: readonly RenderChunkTransform[];
}): WorldResidencyIndex {
	const anchor = inferRenderAnchor(options.renderChunkTransforms);
	if (!anchor) {
		return createEmptyWorldResidencyIndex();
	}

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
			items,
			root: buildResidencyBvh(items),
		});
	}

	return {
		cellCount,
		landblockCount: landblocks.size,
		query: (position) => queryWorldResidencyIndex(position, anchor, landblocks),
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
): CameraViewResidencyContext {
	const landblockResidency = computeRendererPositionLandblockResidency(
		position,
		anchor,
	);
	if (!landblockResidency) {
		return { kind: "unknown", landblockId: null };
	}

	const landblock = landblocks.get(landblockResidency.landblockId);
	if (!landblock) {
		return {
			kind: "outdoor-landblock",
			landblockId: landblockResidency.landblockId,
		};
	}

	const matches = queryResidencyBvh(
		landblock.root,
		landblockResidency.landblockRelativePosition,
	);
	const nearest = selectNearestResidencyCell(
		matches,
		landblockResidency.landblockRelativePosition,
	);
	if (!nearest) {
		return {
			kind: "outdoor-landblock",
			landblockId: landblock.landblockId,
		};
	}

	return {
		kind: "env-cell",
		landblockId: nearest.landblockId,
		envCellId: nearest.envCellId,
	};
}

function deriveResidencyCellItem(
	cell: StructuredInteriorCell,
): ResidencyCellItem | null {
	const bounds = deriveResidencyCellBounds(cell);
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
	};
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
