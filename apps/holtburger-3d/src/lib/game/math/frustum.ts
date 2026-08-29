import type { AABB3, Mat4, Vec3 } from "./types";
import { multiplyMat4 } from "./matrices";

/** One inward-facing normalized plane in an anchor-relative render frame. */
interface FrustumPlane {
	x: number;
	y: number;
	z: number;
	constant: number;
}

/** Camera frustum expressed in one anchor-relative render frame. */
export interface Frustum {
	readonly cameraPosition: Vec3;
	readonly planes: readonly FrustumPlane[];
}

/** Extract the six inward-facing clip planes from a projection-view transform. */
export function createFrustum(
	projection: Mat4,
	view: Mat4,
	cameraPosition: Vec3,
): Frustum {
	return createFrustumFromClipMatrix(
		multiplyMat4(projection, view),
		cameraPosition,
	);
}

/** Extract a frustum from one already-composed anchor-to-clip transform. */
export function createFrustumFromClipMatrix(
	clip: Mat4,
	cameraPosition: Vec3,
	target?: Frustum,
): Frustum {
	const resolved = target ?? {
		cameraPosition: cameraPosition.clone(),
		planes: [],
	};
	resolved.cameraPosition.copy(cameraPosition);
	const planes = resolved.planes as FrustumPlane[];
	planes[0] = normalizePlane(
		clip.m14 + clip.m11,
		clip.m24 + clip.m21,
		clip.m34 + clip.m31,
		clip.m44 + clip.m41,
		planes[0],
	);
	planes[1] = normalizePlane(
		clip.m14 - clip.m11,
		clip.m24 - clip.m21,
		clip.m34 - clip.m31,
		clip.m44 - clip.m41,
		planes[1],
	);
	planes[2] = normalizePlane(
		clip.m14 + clip.m12,
		clip.m24 + clip.m22,
		clip.m34 + clip.m32,
		clip.m44 + clip.m42,
		planes[2],
	);
	planes[3] = normalizePlane(
		clip.m14 - clip.m12,
		clip.m24 - clip.m22,
		clip.m34 - clip.m32,
		clip.m44 - clip.m42,
		planes[3],
	);
	planes[4] = normalizePlane(
		clip.m14 + clip.m13,
		clip.m24 + clip.m23,
		clip.m34 + clip.m33,
		clip.m44 + clip.m43,
		planes[4],
	);
	planes[5] = normalizePlane(
		clip.m14 - clip.m13,
		clip.m24 - clip.m23,
		clip.m34 - clip.m33,
		clip.m44 - clip.m43,
		planes[5],
	);
	planes.length = 6;
	return resolved;
}

/** Conservatively test one offset AABB against every frustum plane. */
export function frustumIntersectsAABB(
	frustum: Frustum,
	bounds: AABB3,
	offsetX: number,
	offsetY: number,
	offsetZ: number,
): boolean {
	for (const plane of frustum.planes) {
		const x = (plane.x >= 0 ? bounds.max.x : bounds.min.x) + offsetX;
		const y = (plane.y >= 0 ? bounds.max.y : bounds.min.y) + offsetY;
		const z = (plane.z >= 0 ? bounds.max.z : bounds.min.z) + offsetZ;
		if (plane.x * x + plane.y * y + plane.z * z + plane.constant < 0)
			return false;
	}
	return true;
}

function normalizePlane(
	x: number,
	y: number,
	z: number,
	constant: number,
	target?: FrustumPlane,
): FrustumPlane {
	const length = Math.hypot(x, y, z);
	if (length === 0) throw new Error("Frustum contains a degenerate plane.");
	const resolved = target ?? { constant: 0, x: 0, y: 0, z: 0 };
	resolved.constant = constant / length;
	resolved.x = x / length;
	resolved.y = y / length;
	resolved.z = z / length;
	return resolved;
}
