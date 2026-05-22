import type { RenderSpatialItemId } from "./render-spatial-ids";
import type { PortalOverlayTargetStatus } from "./debug-overlays";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderChunkKey } from "./render-chunks";

export type RenderSpatialItemKind =
	| "terrain"
	| "structured-cell"
	| "portal"
	| "outdoor-static"
	| "building"
	| "indoor-static";

export interface RenderVec3 {
	x: number;
	y: number;
	z: number;
}

interface RenderRay {
	origin: RenderVec3;
	direction: RenderVec3;
}

interface RenderPlane {
	normal: RenderVec3;
	constant: number;
}

export interface RenderFrustum {
	planes: RenderPlane[];
}

export interface RenderBounds {
	min: RenderVec3;
	max: RenderVec3;
}

type RenderPickShape =
	| { kind: "box"; bounds: RenderBounds }
	| { kind: "sphere"; center: RenderVec3; radius: number }
	| { kind: "polygon"; points: RenderVec3[]; thickness: number };

export type RenderSpatialMetadata =
	| {
			kind: "terrain";
			landblockId: number;
			assetId: string;
			terrainQuad: {
				row: number;
				col: number;
				quadIndex: number;
				triangleIndices: [number, number];
			} | null;
	  }
	| {
			kind: "structured-cell";
			envCellId: number;
			renderKey: string;
			isFocus: boolean;
	  }
	| {
			kind: "portal";
			portalId: string;
			sourceEnvCellId: number;
			targetEnvCellId: number | null;
			targetStatus: PortalOverlayTargetStatus;
			polygonId: number;
			otherPortalId: number;
			flags: number;
	  }
	| {
			kind: "landblock-pack-spatial";
			spatialKind: Exclude<
				RenderSpatialItemKind,
				"terrain" | "structured-cell" | "portal"
			>;
			itemId: string;
			landblockId: number;
			ownerId: number | null;
			sourceAssetId: string | null;
	  };

export interface RenderSpatialItem {
	id: RenderSpatialItemId;
	kind: RenderSpatialItemKind;
	ownerKey: string;
	chunkKey: RenderChunkKey;
	broadphaseBounds: RenderBounds;
	pickShape?: RenderPickShape;
	metadata: RenderSpatialMetadata;
}

export interface RenderSpatialPick {
	item: RenderSpatialItem;
	distance: number;
	point: RenderVec3;
}

interface RenderSpatialIndexSink {
	clearOwner(ownerKey: string): void;
	replaceOwnerItems(ownerKey: string, items: RenderSpatialItem[]): void;
	upsertItem(item: RenderSpatialItem): void;
	removeItem(itemId: RenderSpatialItemId): void;
}

interface RenderSpatialChunkSink {
	replaceChunkTransforms(transforms: RenderChunkTransform[]): void;
	removeChunkTransform(chunkKey: RenderChunkKey): void;
}

export interface RenderSpatialIndexQuery {
	hasItem(itemId: RenderSpatialItemId): boolean;
	pickRay(
		ray: RenderRay,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null;
	queryFrustum(
		frustum: RenderFrustum,
		mask: ReadonlySet<RenderSpatialItemKind>,
	): RenderSpatialItem[];
}

export interface RenderSpatialIndex
	extends
		RenderSpatialIndexSink,
		RenderSpatialChunkSink,
		RenderSpatialIndexQuery {}

export function createLinearRenderSpatialIndex(): RenderSpatialIndex {
	const itemsById = new Map<RenderSpatialItemId, RenderSpatialItem>();
	const itemIdsByOwner = new Map<string, Set<RenderSpatialItemId>>();
	const chunkTransformsByKey = new Map<RenderChunkKey, RenderChunkTransform>();

	function removeItemFromOwner(item: RenderSpatialItem): void {
		const ownerItemIds = itemIdsByOwner.get(item.ownerKey);
		if (!ownerItemIds) {
			return;
		}
		ownerItemIds.delete(item.id);
		if (ownerItemIds.size === 0) {
			itemIdsByOwner.delete(item.ownerKey);
		}
	}

	return {
		clearOwner(ownerKey) {
			const ownerItemIds = itemIdsByOwner.get(ownerKey);
			if (ownerItemIds) {
				for (const itemId of ownerItemIds) {
					itemsById.delete(itemId);
				}
				itemIdsByOwner.delete(ownerKey);
			}
		},
		replaceOwnerItems(ownerKey, items) {
			const nextItemIds = new Set(items.map((item) => item.id));
			const ownerItemIds = itemIdsByOwner.get(ownerKey);
			if (ownerItemIds) {
				for (const itemId of ownerItemIds) {
					if (!nextItemIds.has(itemId)) {
						itemsById.delete(itemId);
					}
				}
			}

			itemIdsByOwner.set(ownerKey, nextItemIds);
			for (const item of items) {
				const previousItem = itemsById.get(item.id);
				if (previousItem && previousItem.ownerKey !== ownerKey) {
					removeItemFromOwner(previousItem);
				}
				itemsById.set(item.id, item);
			}

			if (nextItemIds.size === 0) {
				itemIdsByOwner.delete(ownerKey);
			}
		},
		upsertItem(item) {
			const previousItem = itemsById.get(item.id);
			if (previousItem) {
				removeItemFromOwner(previousItem);
			}
			itemsById.set(item.id, item);
			const ownerItemIds = itemIdsByOwner.get(item.ownerKey) ?? new Set();
			ownerItemIds.add(item.id);
			itemIdsByOwner.set(item.ownerKey, ownerItemIds);
		},
		removeItem(itemId) {
			const item = itemsById.get(itemId);
			if (!item) {
				return;
			}
			itemsById.delete(itemId);
			removeItemFromOwner(item);
		},
		replaceChunkTransforms(transforms) {
			chunkTransformsByKey.clear();
			for (const transform of transforms) {
				chunkTransformsByKey.set(transform.chunkKey, transform);
			}
		},
		removeChunkTransform(chunkKey) {
			chunkTransformsByKey.delete(chunkKey);
		},
		hasItem(itemId) {
			return itemsById.has(itemId);
		},
		pickRay(ray, mask, ownerKeys) {
			let nearestPick: RenderSpatialPick | null = null;
			for (const item of itemsById.values()) {
				if (!mask.has(item.kind)) {
					continue;
				}
				if (ownerKeys && !ownerKeys.has(item.ownerKey)) {
					continue;
				}
				const transform = resolveItemChunkTransform(item, chunkTransformsByKey);
				const queryRay = rendererRayToChunkLocal(ray, transform.offset);
				const broadphaseDistance = intersectRayBounds(
					queryRay,
					item.broadphaseBounds,
				);
				if (broadphaseDistance === null) {
					continue;
				}

				const precisePick = pickShape(
					queryRay,
					item.pickShape,
					item.broadphaseBounds,
				);
				if (!precisePick) {
					continue;
				}
				const renderPoint = chunkLocalPointToRendererLocal(
					precisePick.point,
					transform.offset,
				);
				const renderDistance = distanceBetween(ray.origin, renderPoint);
				if (!nearestPick || renderDistance < nearestPick.distance) {
					nearestPick = {
						item,
						distance: renderDistance,
						point: renderPoint,
					};
				}
			}
			return nearestPick;
		},
		queryFrustum(frustum, mask) {
			return [...itemsById.values()].filter((item) => {
				if (!mask.has(item.kind)) {
					return false;
				}
				const transform = resolveItemChunkTransform(item, chunkTransformsByKey);
				return intersectsFrustum(
					translateBounds(item.broadphaseBounds, transform.offset),
					frustum,
				);
			});
		},
	};
}

function resolveItemChunkTransform(
	item: RenderSpatialItem,
	chunkTransformsByKey: ReadonlyMap<RenderChunkKey, RenderChunkTransform>,
): RenderChunkTransform {
	const transform = chunkTransformsByKey.get(item.chunkKey);
	if (!transform) {
		throw new Error(
			`Render spatial item ${item.id} references missing chunk transform ${item.chunkKey}.`,
		);
	}
	return transform;
}

function rendererRayToChunkLocal(
	ray: RenderRay,
	offset: RenderVec3,
): RenderRay {
	return {
		origin: subtract(ray.origin, offset),
		direction: ray.direction,
	};
}

function chunkLocalPointToRendererLocal(
	point: RenderVec3,
	offset: RenderVec3,
): RenderVec3 {
	return add(point, offset);
}

function translateBounds(
	bounds: RenderBounds,
	offset: RenderVec3,
): RenderBounds {
	return {
		min: add(bounds.min, offset),
		max: add(bounds.max, offset),
	};
}

function add(left: RenderVec3, right: RenderVec3): RenderVec3 {
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

function subtract(left: RenderVec3, right: RenderVec3): RenderVec3 {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function distanceBetween(left: RenderVec3, right: RenderVec3): number {
	return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function intersectsFrustum(
	bounds: RenderBounds,
	frustum: RenderFrustum,
): boolean {
	for (const plane of frustum.planes) {
		const positiveVertex = {
			x: plane.normal.x >= 0 ? bounds.max.x : bounds.min.x,
			y: plane.normal.y >= 0 ? bounds.max.y : bounds.min.y,
			z: plane.normal.z >= 0 ? bounds.max.z : bounds.min.z,
		};
		if (dot(plane.normal, positiveVertex) + plane.constant < 0) {
			return false;
		}
	}
	return true;
}

function pickShape(
	ray: RenderRay,
	shape: RenderPickShape | undefined,
	fallbackBounds: RenderBounds,
): { distance: number; point: RenderVec3 } | null {
	if (!shape || shape.kind === "box") {
		const bounds = shape?.kind === "box" ? shape.bounds : fallbackBounds;
		const distance = intersectRayBounds(ray, bounds);
		return distance === null
			? null
			: { distance, point: pointOnRay(ray, distance) };
	}
	if (shape.kind === "sphere") {
		const distance = intersectRaySphere(ray, shape.center, shape.radius);
		return distance === null
			? null
			: { distance, point: pointOnRay(ray, distance) };
	}

	return intersectRayPolygon(ray, shape.points, shape.thickness);
}

function intersectRayBounds(
	ray: RenderRay,
	bounds: RenderBounds,
): number | null {
	let minDistance = 0;
	let maxDistance = Number.POSITIVE_INFINITY;
	for (const axis of ["x", "y", "z"] as const) {
		const origin = ray.origin[axis];
		const direction = ray.direction[axis];
		const min = bounds.min[axis];
		const max = bounds.max[axis];
		if (Math.abs(direction) < 1e-8) {
			if (origin < min || origin > max) {
				return null;
			}
			continue;
		}
		const inverseDirection = 1 / direction;
		let near = (min - origin) * inverseDirection;
		let far = (max - origin) * inverseDirection;
		if (near > far) {
			[near, far] = [far, near];
		}
		minDistance = Math.max(minDistance, near);
		maxDistance = Math.min(maxDistance, far);
		if (minDistance > maxDistance) {
			return null;
		}
	}
	return maxDistance < 0 ? null : minDistance;
}

function intersectRaySphere(
	ray: RenderRay,
	center: RenderVec3,
	radius: number,
): number | null {
	const toCenter = subtract(ray.origin, center);
	const b = dot(toCenter, ray.direction);
	const c = dot(toCenter, toCenter) - radius * radius;
	const discriminant = b * b - c;
	if (discriminant < 0) {
		return null;
	}
	const offset = Math.sqrt(discriminant);
	const near = -b - offset;
	if (near >= 0) {
		return near;
	}
	const far = -b + offset;
	return far >= 0 ? far : null;
}

function intersectRayPolygon(
	ray: RenderRay,
	points: RenderVec3[],
	thickness: number,
): { distance: number; point: RenderVec3 } | null {
	if (points.length < 3) {
		return null;
	}
	const normal = normalize(
		cross(subtract(points[1], points[0]), subtract(points[2], points[0])),
	);
	const denominator = dot(normal, ray.direction);
	if (Math.abs(denominator) < 1e-8) {
		return null;
	}
	const distance = dot(subtract(points[0], ray.origin), normal) / denominator;
	if (distance < 0) {
		return null;
	}
	const point = pointOnRay(ray, distance);
	const planeDistance = Math.abs(dot(subtract(point, points[0]), normal));
	if (planeDistance > thickness) {
		return null;
	}
	if (!isPointInConvexPolygon(point, points, normal)) {
		return null;
	}
	return { distance, point };
}

function isPointInConvexPolygon(
	point: RenderVec3,
	points: RenderVec3[],
	normal: RenderVec3,
): boolean {
	let sign = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		if (!current || !next) {
			return false;
		}
		const edge = subtract(next, current);
		const toPoint = subtract(point, current);
		const side = dot(cross(edge, toPoint), normal);
		if (Math.abs(side) < 1e-7) {
			continue;
		}
		const nextSign = Math.sign(side);
		if (sign === 0) {
			sign = nextSign;
		} else if (sign !== nextSign) {
			return false;
		}
	}
	return true;
}

function pointOnRay(ray: RenderRay, distance: number): RenderVec3 {
	return {
		x: ray.origin.x + ray.direction.x * distance,
		y: ray.origin.y + ray.direction.y * distance,
		z: ray.origin.z + ray.direction.z * distance,
	};
}

function dot(left: RenderVec3, right: RenderVec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: RenderVec3, right: RenderVec3): RenderVec3 {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function normalize(vector: RenderVec3): RenderVec3 {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return { x: 0, y: 0, z: 0 };
	}
	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}
