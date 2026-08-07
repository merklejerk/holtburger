import { AABB3, Vec3 } from "../math/types";

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

/** Grow `bounds` outward by `radius` on every axis; a non-positive radius returns it unchanged. */
export function expandBounds(bounds: AABB3, radius: number): AABB3 {
	if (radius <= 0) return bounds;
	return new AABB3(
		new Vec3(
			bounds.min.x - radius,
			bounds.min.y - radius,
			bounds.min.z - radius,
		),
		new Vec3(
			bounds.max.x + radius,
			bounds.max.y + radius,
			bounds.max.z + radius,
		),
	);
}

export function translateBounds(
	bounds: AABB3,
	translation: Vec3,
	targetBounds?: AABB3,
): AABB3 {
	const minX = bounds.min.x + translation.x;
	const minY = bounds.min.y + translation.y;
	const minZ = bounds.min.z + translation.z;
	const maxX = bounds.max.x + translation.x;
	const maxY = bounds.max.y + translation.y;
	const maxZ = bounds.max.z + translation.z;
	if (targetBounds) {
		targetBounds.min.x = minX;
		targetBounds.min.y = minY;
		targetBounds.min.z = minZ;
		targetBounds.max.x = maxX;
		targetBounds.max.y = maxY;
		targetBounds.max.z = maxZ;
		return targetBounds;
	}
	return new AABB3(new Vec3(minX, minY, minZ), new Vec3(maxX, maxY, maxZ));
}
