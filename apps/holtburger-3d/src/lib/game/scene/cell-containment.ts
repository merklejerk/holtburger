import { inverseTransformRigidPoint3 } from "../math/matrices";
import { type Mat4, Vec3 } from "../math/types";

/** Retail `CCellStruct::point_in_cell` tolerance in CellStruct-local AC units. */
export const CELL_CONTAINMENT_EPSILON = 0.0002;

/**
 * Test a landblock-local renderer point against retail's positive-child Cell BSP plane chain.
 *
 * Projected planes intentionally retain AC axes. The EnvCell frame is represented in renderer
 * axes, so the inverse-frame result must be converted back to AC `(x, y, z)` before plane tests.
 */
export function cellContainsLandblockPoint(
	containmentPlanes: Float32Array,
	structureToLandblock: Mat4,
	landblockPoint: Vec3,
): boolean {
	if (containmentPlanes.length % 4 !== 0) {
		throw new Error("Cell containment planes must contain complete tuples.");
	}
	const localRenderPoint = inverseTransformRigidPoint3(
		structureToLandblock,
		landblockPoint,
	);
	const localAcX = localRenderPoint.x;
	const localAcY = -localRenderPoint.z;
	const localAcZ = localRenderPoint.y;
	for (let index = 0; index < containmentPlanes.length; index += 4) {
		const distance =
			containmentPlanes[index]! * localAcX +
			containmentPlanes[index + 1]! * localAcY +
			containmentPlanes[index + 2]! * localAcZ +
			containmentPlanes[index + 3]!;
		if (distance < -CELL_CONTAINMENT_EPSILON) return false;
	}
	return true;
}
