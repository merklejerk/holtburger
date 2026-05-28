export interface RenderVec3 {
	x: number;
	y: number;
	z: number;
}

export interface RenderRay {
	origin: RenderVec3;
	direction: RenderVec3;
}

export interface RenderPlane {
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

export function addRenderVec3(left: RenderVec3, right: RenderVec3): RenderVec3 {
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

export function subtractRenderVec3(
	left: RenderVec3,
	right: RenderVec3,
): RenderVec3 {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

export function translateRenderBounds(
	bounds: RenderBounds,
	offset: RenderVec3,
): RenderBounds {
	return {
		min: addRenderVec3(bounds.min, offset),
		max: addRenderVec3(bounds.max, offset),
	};
}

export function distanceBetweenRenderVec3(
	left: RenderVec3,
	right: RenderVec3,
): number {
	return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function renderBoundsIntersectsFrustum(
	bounds: RenderBounds,
	frustum: RenderFrustum,
): boolean {
	for (const plane of frustum.planes) {
		const positiveVertex = {
			x: plane.normal.x >= 0 ? bounds.max.x : bounds.min.x,
			y: plane.normal.y >= 0 ? bounds.max.y : bounds.min.y,
			z: plane.normal.z >= 0 ? bounds.max.z : bounds.min.z,
		};
		if (dotRenderVec3(plane.normal, positiveVertex) + plane.constant < 0) {
			return false;
		}
	}
	return true;
}

export function renderBoundsContainedByFrustum(
	bounds: RenderBounds,
	frustum: RenderFrustum,
): boolean {
	for (const plane of frustum.planes) {
		const negativeVertex = {
			x: plane.normal.x >= 0 ? bounds.min.x : bounds.max.x,
			y: plane.normal.y >= 0 ? bounds.min.y : bounds.max.y,
			z: plane.normal.z >= 0 ? bounds.min.z : bounds.max.z,
		};
		if (dotRenderVec3(plane.normal, negativeVertex) + plane.constant < 0) {
			return false;
		}
	}
	return true;
}

export function intersectRayRenderBounds(
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

export function dotRenderVec3(left: RenderVec3, right: RenderVec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function crossRenderVec3(
	left: RenderVec3,
	right: RenderVec3,
): RenderVec3 {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

export function normalizeRenderVec3(vector: RenderVec3): RenderVec3 {
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
