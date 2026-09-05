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

/** Grow bounds into optional caller storage; non-positive radii preserve the input extent. */
export function expandBounds(
	bounds: AABB3,
	radius: number,
	targetBounds?: AABB3,
): AABB3 {
	if (radius <= 0)
		return targetBounds === undefined ? bounds : targetBounds.copy(bounds);
	const target = targetBounds ?? AABB3.zero();
	target.min.x = bounds.min.x - radius;
	target.min.y = bounds.min.y - radius;
	target.min.z = bounds.min.z - radius;
	target.max.x = bounds.max.x + radius;
	target.max.y = bounds.max.y + radius;
	target.max.z = bounds.max.z + radius;
	return target;
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
