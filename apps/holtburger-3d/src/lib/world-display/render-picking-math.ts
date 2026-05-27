import {
	crossRenderVec3,
	dotRenderVec3,
	intersectRayRenderBounds,
	normalizeRenderVec3,
	subtractRenderVec3,
	type RenderBounds,
	type RenderRay,
	type RenderVec3,
} from "./render-spatial-math";

export type RenderPickShape =
	| { kind: "box"; bounds: RenderBounds }
	| { kind: "sphere"; center: RenderVec3; radius: number }
	| { kind: "polygon"; points: RenderVec3[]; thickness: number };

export interface RenderShapePick {
	distance: number;
	point: RenderVec3;
}

export function pickRenderShape(
	ray: RenderRay,
	shape: RenderPickShape | undefined,
	fallbackBounds: RenderBounds,
): RenderShapePick | null {
	if (!shape || shape.kind === "box") {
		const bounds = shape?.kind === "box" ? shape.bounds : fallbackBounds;
		const distance = intersectRayRenderBounds(ray, bounds);
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

export function intersectRaySphere(
	ray: RenderRay,
	center: RenderVec3,
	radius: number,
): number | null {
	const toCenter = subtractRenderVec3(ray.origin, center);
	const b = dotRenderVec3(toCenter, ray.direction);
	const c = dotRenderVec3(toCenter, toCenter) - radius * radius;
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

export function intersectRayPolygon(
	ray: RenderRay,
	points: RenderVec3[],
	thickness: number,
): RenderShapePick | null {
	if (points.length < 3) {
		return null;
	}
	const normal = normalizeRenderVec3(
		crossRenderVec3(
			subtractRenderVec3(points[1], points[0]),
			subtractRenderVec3(points[2], points[0]),
		),
	);
	const denominator = dotRenderVec3(normal, ray.direction);
	if (Math.abs(denominator) < 1e-8) {
		return null;
	}
	const distance =
		dotRenderVec3(subtractRenderVec3(points[0], ray.origin), normal) /
		denominator;
	if (distance < 0) {
		return null;
	}
	const point = pointOnRay(ray, distance);
	const planeDistance = Math.abs(
		dotRenderVec3(subtractRenderVec3(point, points[0]), normal),
	);
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
		const edge = subtractRenderVec3(next, current);
		const toPoint = subtractRenderVec3(point, current);
		const side = dotRenderVec3(crossRenderVec3(edge, toPoint), normal);
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
