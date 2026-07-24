import type { AABB2, AABB3, Vec2, Vec3 } from "../math/types";

export function containsPoint(bounds: AABB3, point: Vec3): boolean {
	return (
		point.x >= bounds.min.x &&
		point.x <= bounds.max.x &&
		point.y >= bounds.min.y &&
		point.y <= bounds.max.y &&
		point.z >= bounds.min.z &&
		point.z <= bounds.max.z
	);
}

export function translateBounds(bounds: AABB3, translation: Vec3): AABB3 {
	return {
		min: bounds.min.add(translation),
		max: bounds.max.add(translation),
	};
}

/**
 * Return the radius of the largest circle around `point` that remains inside `bounds`.
 *
 * Callers provide coordinates in whichever two-dimensional plane their domain uses.  Terrain
 * callers use canonical scene X/Z coordinates, deliberately excluding world-up from distance
 * policy.
 */
export function distanceToBoundsEdge2D(bounds: AABB2, point: Vec2): number {
	if (
		point.x < bounds.min.x ||
		point.x > bounds.max.x ||
		point.y < bounds.min.y ||
		point.y > bounds.max.y
	) {
		return 0;
	}
	return Math.min(
		point.x - bounds.min.x,
		bounds.max.x - point.x,
		point.y - bounds.min.y,
		bounds.max.y - point.y,
	);
}
