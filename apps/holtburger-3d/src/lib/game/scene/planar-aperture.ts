import { Vec3 } from "../math/types";

/** Shared retail-scale tolerance for finite portal geometry and directed side queries. */
export const PORTAL_QUERY_EPSILON = 0.0002;

/** Renderer-space plane equation with a normalized authored normal. */
export interface PlanarAperturePlane {
	readonly normal: Vec3;
	readonly d: number;
}

/** Pure finite planar aperture geometry; vertices contain packed xyz tuples. */
export interface PlanarAperture {
	readonly indices: Uint32Array;
	readonly plane: PlanarAperturePlane;
	readonly vertices: Float32Array;
}

/** Finite segment intersection with an aperture's supporting plane. */
export type SegmentPlaneIntersection =
	| {
			readonly kind: "point";
			readonly point: Vec3;
			/** Forward parameter in the closed segment interval `[0, 1]`. */
			readonly t: number;
	  }
	| {
			readonly kind: "coplanar";
	  }
	| {
			readonly kind: "none";
	  };

/** Return authored signed distance. Projected portal planes are normalized by the host. */
export function signedPlaneDistance(
	plane: PlanarAperturePlane,
	point: Vec3,
): number {
	return (
		plane.normal.x * point.x +
		plane.normal.y * point.y +
		plane.normal.z * point.z +
		plane.d
	);
}

/** Intersect one closed segment with a plane while retaining coplanar provenance. */
export function intersectSegmentPlane(
	start: Vec3,
	end: Vec3,
	plane: PlanarAperturePlane,
): SegmentPlaneIntersection {
	const startDistance = signedPlaneDistance(plane, start);
	const endDistance = signedPlaneDistance(plane, end);
	if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) {
		throw new Error("Portal segment-plane query contains non-finite values.");
	}
	const delta = endDistance - startDistance;
	if (
		Math.abs(startDistance) <= PORTAL_QUERY_EPSILON &&
		Math.abs(endDistance) <= PORTAL_QUERY_EPSILON
	) {
		return { kind: "coplanar" };
	}
	if (
		Math.abs(delta) <=
		Number.EPSILON * Math.max(1, Math.abs(startDistance), Math.abs(endDistance))
	) {
		return { kind: "none" };
	}
	const t = -startDistance / delta;
	if (t < 0 || t > 1) return { kind: "none" };
	return {
		kind: "point",
		point: new Vec3(
			start.x + (end.x - start.x) * t,
			start.y + (end.y - start.y) * t,
			start.z + (end.z - start.z) * t,
		),
		t,
	};
}

/** Test a coplanar point against every authored aperture triangle, including its epsilon boundary. */
export function pointInTriangulatedAperture(
	point: Vec3,
	aperture: PlanarAperture,
): boolean {
	validatePlanarAperture(aperture);
	for (let index = 0; index < aperture.indices.length; index += 3) {
		const first = vertexAt(aperture.vertices, aperture.indices[index]!);
		const second = vertexAt(aperture.vertices, aperture.indices[index + 1]!);
		const third = vertexAt(aperture.vertices, aperture.indices[index + 2]!);
		if (pointInTriangle(point, first, second, third, aperture.plane.normal)) {
			return true;
		}
	}
	return false;
}

function pointInTriangle(
	point: Vec3,
	first: Vec3,
	second: Vec3,
	third: Vec3,
	normal: Vec3,
): boolean {
	const edges = [
		[first, second],
		[second, third],
		[third, first],
	] as const;
	let allPositive = true;
	let allNegative = true;
	for (const [start, end] of edges) {
		const edgeX = end.x - start.x;
		const edgeY = end.y - start.y;
		const edgeZ = end.z - start.z;
		const edgeLength = Math.hypot(edgeX, edgeY, edgeZ);
		if (edgeLength === 0 || !Number.isFinite(edgeLength)) {
			throw new Error("Portal aperture contains a degenerate triangle edge.");
		}
		const pointX = point.x - start.x;
		const pointY = point.y - start.y;
		const pointZ = point.z - start.z;
		const crossX = edgeY * pointZ - edgeZ * pointY;
		const crossY = edgeZ * pointX - edgeX * pointZ;
		const crossZ = edgeX * pointY - edgeY * pointX;
		const edgeDistance =
			(crossX * normal.x + crossY * normal.y + crossZ * normal.z) / edgeLength;
		allPositive &&= edgeDistance >= -PORTAL_QUERY_EPSILON;
		allNegative &&= edgeDistance <= PORTAL_QUERY_EPSILON;
	}
	return allPositive || allNegative;
}

/** Reject malformed, non-finite, or non-normalized aperture geometry. */
export function validatePlanarAperture(aperture: PlanarAperture): void {
	if (
		aperture.vertices.length % 3 !== 0 ||
		aperture.indices.length === 0 ||
		aperture.indices.length % 3 !== 0
	) {
		throw new Error("Portal aperture contains invalid triangle buffers.");
	}
	const vertexCount = aperture.vertices.length / 3;
	if (aperture.indices.some((index) => index >= vertexCount)) {
		throw new Error("Portal aperture index exceeds its vertex buffer.");
	}
	const normalLength = Math.hypot(
		aperture.plane.normal.x,
		aperture.plane.normal.y,
		aperture.plane.normal.z,
	);
	for (const coordinate of aperture.vertices) {
		if (!Number.isFinite(coordinate)) {
			throw new Error("Portal aperture plane must be finite and normalized.");
		}
	}
	if (
		!Number.isFinite(aperture.plane.normal.x) ||
		!Number.isFinite(aperture.plane.normal.y) ||
		!Number.isFinite(aperture.plane.normal.z) ||
		!Number.isFinite(aperture.plane.d) ||
		Math.abs(normalLength - 1) > 0.000_01
	) {
		throw new Error("Portal aperture plane must be finite and normalized.");
	}
}

function vertexAt(vertices: Float32Array, index: number): Vec3 {
	const offset = index * 3;
	return new Vec3(
		vertices[offset]!,
		vertices[offset + 1]!,
		vertices[offset + 2]!,
	);
}
