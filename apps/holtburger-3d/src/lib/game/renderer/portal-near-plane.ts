import type { Camera } from "../runtime/types";
import { Quat, Vec3 } from "../math/types";
import {
	intersectSegmentPlane,
	type PlanarAperture,
	type PlanarAperturePlane,
	pointInTriangulatedAperture,
	signedPlaneDistance,
	PORTAL_QUERY_EPSILON,
} from "../scene/planar-aperture";

/** One deliberate geometric tolerance for renderer-only portal contact decisions. */
const PORTAL_RENDER_EPSILON = PORTAL_QUERY_EPSILON;

/** Finite camera near-plane quad ordered counter-clockwise from the camera's view. */
export interface CameraNearPlaneQuad {
	readonly aperture: PlanarAperture;
	readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
}

/** Build the exact finite near-plane quad in canonical world coordinates. */
export function createCameraNearPlaneQuad(
	camera: Camera,
	aspectRatio: number,
): CameraNearPlaneQuad {
	if (
		!Number.isFinite(camera.fov) ||
		camera.fov <= 0 ||
		camera.fov >= 180 ||
		!Number.isFinite(camera.near) ||
		camera.near <= 0 ||
		!Number.isFinite(aspectRatio) ||
		aspectRatio <= 0
	) {
		throw new Error(
			"Camera near-plane projection facts must be finite and positive.",
		);
	}
	const halfHeight = camera.near * Math.tan((camera.fov * Math.PI) / 360);
	const halfWidth = halfHeight * aspectRatio;
	const localCorners = [
		new Vec3(-halfWidth, -halfHeight, -camera.near),
		new Vec3(halfWidth, -halfHeight, -camera.near),
		new Vec3(halfWidth, halfHeight, -camera.near),
		new Vec3(-halfWidth, halfHeight, -camera.near),
	] as const;
	const corners = localCorners.map((corner) =>
		rotateAndTranslate(
			corner,
			camera.placement.rotation,
			camera.placement.position,
		),
	) as unknown as [Vec3, Vec3, Vec3, Vec3];
	const normal = rotateVector(new Vec3(0, 0, -1), camera.placement.rotation);
	const plane = {
		d: -dot(normal, corners[0]),
		normal,
	};
	return {
		aperture: {
			indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
			plane,
			vertices: new Float32Array(
				corners.flatMap((corner) => [corner.x, corner.y, corner.z]),
			),
		},
		corners,
	};
}

/** Test the finite camera near-plane quad against actual aperture triangles. */
export function cameraNearPlaneIntersectsAperture(
	nearPlane: CameraNearPlaneQuad,
	aperture: PlanarAperture,
): boolean {
	return triangulatedPlanarAperturesIntersect(nearPlane.aperture, aperture);
}

/** Inclusive finite intersection for arbitrary triangulated planar aperture unions. */
export function triangulatedPlanarAperturesIntersect(
	first: PlanarAperture,
	second: PlanarAperture,
): boolean {
	for (const point of vertices(first)) {
		if (
			Math.abs(signedPlaneDistance(second.plane, point)) <=
				PORTAL_RENDER_EPSILON &&
			pointInTriangulatedAperture(point, second)
		) {
			return true;
		}
	}
	for (const point of vertices(second)) {
		if (
			Math.abs(signedPlaneDistance(first.plane, point)) <=
				PORTAL_RENDER_EPSILON &&
			pointInTriangulatedAperture(point, first)
		) {
			return true;
		}
	}
	for (const [start, end] of triangleEdges(first)) {
		const intersection = intersectSegmentPlane(start, end, second.plane);
		if (
			intersection.kind === "point" &&
			pointInTriangulatedAperture(intersection.point, second)
		) {
			return true;
		}
	}
	for (const [start, end] of triangleEdges(second)) {
		const intersection = intersectSegmentPlane(start, end, first.plane);
		if (
			intersection.kind === "point" &&
			pointInTriangulatedAperture(intersection.point, first)
		) {
			return true;
		}
	}
	if (!planesAreCoplanar(first.plane, second.plane)) return false;
	const projectionAxis = dominantAxis(first.plane.normal);
	for (const firstEdge of triangleEdges(first)) {
		for (const secondEdge of triangleEdges(second)) {
			if (coplanarSegmentsIntersect(firstEdge, secondEdge, projectionAxis)) {
				return true;
			}
		}
	}
	return false;
}

function vertices(aperture: PlanarAperture): readonly Vec3[] {
	const result: Vec3[] = [];
	for (let index = 0; index < aperture.vertices.length; index += 3) {
		result.push(
			new Vec3(
				aperture.vertices[index]!,
				aperture.vertices[index + 1]!,
				aperture.vertices[index + 2]!,
			),
		);
	}
	return result;
}

function triangleEdges(
	aperture: PlanarAperture,
): readonly (readonly [Vec3, Vec3])[] {
	const points = vertices(aperture);
	const result: [Vec3, Vec3][] = [];
	for (let index = 0; index < aperture.indices.length; index += 3) {
		const first = points[aperture.indices[index]!];
		const second = points[aperture.indices[index + 1]!];
		const third = points[aperture.indices[index + 2]!];
		if (!first || !second || !third) {
			throw new Error("Portal aperture triangle references a missing vertex.");
		}
		result.push([first, second], [second, third], [third, first]);
	}
	return result;
}

function planesAreCoplanar(
	first: PlanarAperturePlane,
	second: PlanarAperturePlane,
): boolean {
	const alignment = dot(first.normal, second.normal);
	if (1 - Math.abs(alignment) > PORTAL_RENDER_EPSILON) return false;
	const pointOnFirst = new Vec3(
		-first.normal.x * first.d,
		-first.normal.y * first.d,
		-first.normal.z * first.d,
	);
	return (
		Math.abs(signedPlaneDistance(second, pointOnFirst)) <= PORTAL_RENDER_EPSILON
	);
}

function coplanarSegmentsIntersect(
	first: readonly [Vec3, Vec3],
	second: readonly [Vec3, Vec3],
	droppedAxis: 0 | 1 | 2,
): boolean {
	const [firstStart, firstEnd] = first.map((point) =>
		projectPoint(point, droppedAxis),
	) as [[number, number], [number, number]];
	const [secondStart, secondEnd] = second.map((point) =>
		projectPoint(point, droppedAxis),
	) as [[number, number], [number, number]];
	const firstA = orientation(firstStart, firstEnd, secondStart);
	const firstB = orientation(firstStart, firstEnd, secondEnd);
	const secondA = orientation(secondStart, secondEnd, firstStart);
	const secondB = orientation(secondStart, secondEnd, firstEnd);
	if (
		((firstA > PORTAL_RENDER_EPSILON && firstB < -PORTAL_RENDER_EPSILON) ||
			(firstA < -PORTAL_RENDER_EPSILON && firstB > PORTAL_RENDER_EPSILON)) &&
		((secondA > PORTAL_RENDER_EPSILON && secondB < -PORTAL_RENDER_EPSILON) ||
			(secondA < -PORTAL_RENDER_EPSILON && secondB > PORTAL_RENDER_EPSILON))
	) {
		return true;
	}
	return (
		(Math.abs(firstA) <= PORTAL_RENDER_EPSILON &&
			pointOnSegment(secondStart, firstStart, firstEnd)) ||
		(Math.abs(firstB) <= PORTAL_RENDER_EPSILON &&
			pointOnSegment(secondEnd, firstStart, firstEnd)) ||
		(Math.abs(secondA) <= PORTAL_RENDER_EPSILON &&
			pointOnSegment(firstStart, secondStart, secondEnd)) ||
		(Math.abs(secondB) <= PORTAL_RENDER_EPSILON &&
			pointOnSegment(firstEnd, secondStart, secondEnd))
	);
}

function orientation(
	first: readonly [number, number],
	second: readonly [number, number],
	third: readonly [number, number],
): number {
	return (
		(second[0] - first[0]) * (third[1] - first[1]) -
		(second[1] - first[1]) * (third[0] - first[0])
	);
}

function pointOnSegment(
	point: readonly [number, number],
	start: readonly [number, number],
	end: readonly [number, number],
): boolean {
	return (
		point[0] >= Math.min(start[0], end[0]) - PORTAL_RENDER_EPSILON &&
		point[0] <= Math.max(start[0], end[0]) + PORTAL_RENDER_EPSILON &&
		point[1] >= Math.min(start[1], end[1]) - PORTAL_RENDER_EPSILON &&
		point[1] <= Math.max(start[1], end[1]) + PORTAL_RENDER_EPSILON
	);
}

function projectPoint(point: Vec3, droppedAxis: 0 | 1 | 2): [number, number] {
	if (droppedAxis === 0) return [point.y, point.z];
	if (droppedAxis === 1) return [point.x, point.z];
	return [point.x, point.y];
}

function dominantAxis(normal: Vec3): 0 | 1 | 2 {
	const x = Math.abs(normal.x);
	const y = Math.abs(normal.y);
	const z = Math.abs(normal.z);
	return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
}

function rotateAndTranslate(point: Vec3, rotation: Quat, position: Vec3): Vec3 {
	const rotated = rotateVector(point, rotation);
	return new Vec3(
		rotated.x + position.x,
		rotated.y + position.y,
		rotated.z + position.z,
	);
}

function rotateVector(point: Vec3, rotation: Quat): Vec3 {
	const length = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	if (!Number.isFinite(length) || length === 0) {
		throw new Error("Camera rotation must be finite and non-zero.");
	}
	const w = rotation.w / length;
	const x = rotation.x / length;
	const y = rotation.y / length;
	const z = rotation.z / length;
	const tx = 2 * (y * point.z - z * point.y);
	const ty = 2 * (z * point.x - x * point.z);
	const tz = 2 * (x * point.y - y * point.x);
	return new Vec3(
		point.x + w * tx + (y * tz - z * ty),
		point.y + w * ty + (z * tx - x * tz),
		point.z + w * tz + (x * ty - y * tx),
	);
}

function dot(first: Vec3, second: Vec3): number {
	return first.x * second.x + first.y * second.y + first.z * second.z;
}
