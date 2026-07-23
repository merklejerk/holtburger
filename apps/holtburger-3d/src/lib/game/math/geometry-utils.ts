import type { AABB3, Vec3 } from "../math/types";

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
