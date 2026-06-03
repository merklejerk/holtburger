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

export function renderBoundsFromPoints(
	points: readonly RenderVec3[],
): RenderBounds {
	if (points.length === 0) {
		throw new Error("Cannot derive render bounds from an empty point set.");
	}
	const first = points[0];
	if (!first) {
		throw new Error("Cannot derive render bounds without a first point.");
	}
	const bounds: RenderBounds = {
		min: { ...first },
		max: { ...first },
	};
	for (const point of points.slice(1)) {
		bounds.min.x = Math.min(bounds.min.x, point.x);
		bounds.min.y = Math.min(bounds.min.y, point.y);
		bounds.min.z = Math.min(bounds.min.z, point.z);
		bounds.max.x = Math.max(bounds.max.x, point.x);
		bounds.max.y = Math.max(bounds.max.y, point.y);
		bounds.max.z = Math.max(bounds.max.z, point.z);
	}
	return bounds;
}

export function transformRenderBounds(
	bounds: RenderBounds,
	transformPoint: (point: RenderVec3) => RenderVec3,
): RenderBounds {
	return renderBoundsFromPoints(
		renderBoundsCorners(bounds).map((corner) => transformPoint(corner)),
	);
}

function renderBoundsCorners(bounds: RenderBounds): RenderVec3[] {
	const { min, max } = bounds;
	return [
		{ x: min.x, y: min.y, z: min.z },
		{ x: min.x, y: min.y, z: max.z },
		{ x: min.x, y: max.y, z: min.z },
		{ x: min.x, y: max.y, z: max.z },
		{ x: max.x, y: min.y, z: min.z },
		{ x: max.x, y: min.y, z: max.z },
		{ x: max.x, y: max.y, z: min.z },
		{ x: max.x, y: max.y, z: max.z },
	];
}

export function renderBoundsContainsPoint(
	bounds: RenderBounds,
	point: RenderVec3,
): boolean {
	return (
		point.x >= bounds.min.x &&
		point.x <= bounds.max.x &&
		point.y >= bounds.min.y &&
		point.y <= bounds.max.y &&
		point.z >= bounds.min.z &&
		point.z <= bounds.max.z
	);
}

export function unionRenderBounds(
	bounds: readonly RenderBounds[],
): RenderBounds {
	if (bounds.length === 0) {
		throw new Error("Cannot union an empty render-bounds set.");
	}
	const first = bounds[0];
	if (!first) {
		throw new Error("Cannot union render bounds without a first item.");
	}
	const union: RenderBounds = {
		min: { ...first.min },
		max: { ...first.max },
	};
	for (const next of bounds.slice(1)) {
		union.min.x = Math.min(union.min.x, next.min.x);
		union.min.y = Math.min(union.min.y, next.min.y);
		union.min.z = Math.min(union.min.z, next.min.z);
		union.max.x = Math.max(union.max.x, next.max.x);
		union.max.y = Math.max(union.max.y, next.max.y);
		union.max.z = Math.max(union.max.z, next.max.z);
	}
	return union;
}

export function renderBoundsCenter(bounds: RenderBounds): RenderVec3 {
	return {
		x: (bounds.min.x + bounds.max.x) / 2,
		y: (bounds.min.y + bounds.max.y) / 2,
		z: (bounds.min.z + bounds.max.z) / 2,
	};
}

export function renderBoundsSize(bounds: RenderBounds): RenderVec3 {
	return {
		x: bounds.max.x - bounds.min.x,
		y: bounds.max.y - bounds.min.y,
		z: bounds.max.z - bounds.min.z,
	};
}

export function distanceBetweenRenderVec3(
	left: RenderVec3,
	right: RenderVec3,
): number {
	return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function distanceBetweenRenderVec3Squared(
	left: RenderVec3,
	right: RenderVec3,
): number {
	const dx = left.x - right.x;
	const dy = left.y - right.y;
	const dz = left.z - right.z;
	return dx * dx + dy * dy + dz * dz;
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
