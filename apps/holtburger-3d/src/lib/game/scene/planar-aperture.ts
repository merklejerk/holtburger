import { Vec3 } from "../math/types";

/** Shared retail-scale tolerance for portal geometry and directed render-side tests. */
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
