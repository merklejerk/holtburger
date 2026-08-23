import {
	type RenderExtent,
	validateRenderExtent,
} from "../renderer/render-extent";

/** Perspective facts that determine the eye-to-near-plane volume. */
export interface PerspectiveNearPlane {
	/** Vertical field of view in degrees. */
	readonly fov: number;
	/** Positive eye-to-near-plane distance in world meters. */
	readonly near: number;
}

/** Positive half-extents of one perspective near-plane rectangle. */
export interface NearPlaneHalfExtents {
	readonly height: number;
	readonly width: number;
}

/** One frontend-authored projection and its single derived collision-clearance fact. */
export interface ProjectionClearanceRevision extends PerspectiveNearPlane {
	/** Exact eye-centered radius required by this projection. */
	readonly clearanceRadius: number;
	/** Exact drawing-buffer dimensions whose ratio authored this projection. */
	readonly extent: RenderExtent;
	/** Monotonic identity used to acknowledge a projection change across the host boundary. */
	readonly revision: number;
}

/** Validate and materialize one complete projection-clearance revision. */
export function createProjectionClearanceRevision(
	revision: number,
	projection: PerspectiveNearPlane,
	extent: RenderExtent,
): ProjectionClearanceRevision {
	if (!Number.isSafeInteger(revision) || revision <= 0) {
		throw new Error(
			"Camera projection revision must be a positive safe integer.",
		);
	}
	validateRenderExtent(extent, "Camera projection");
	const committedExtent = { ...extent };
	return Object.freeze({
		...projection,
		clearanceRadius: resolveProjectionClearanceRadius(
			projection,
			committedExtent.width / committedExtent.height,
		),
		extent: Object.freeze(committedExtent),
		revision,
	});
}

/** Resolve the exact near-plane half-extents used by the perspective projection. */
export function resolveNearPlaneHalfExtents(
	projection: PerspectiveNearPlane,
	aspectRatio: number,
): NearPlaneHalfExtents {
	validatePerspectiveNearPlane(projection, aspectRatio);
	const height = projection.near * Math.tan((projection.fov * Math.PI) / 360);
	return { height, width: height * aspectRatio };
}

/** Radius of the eye-centered sphere containing the complete near-plane rectangle. */
export function resolveProjectionClearanceRadius(
	projection: PerspectiveNearPlane,
	aspectRatio: number,
): number {
	const half = resolveNearPlaneHalfExtents(projection, aspectRatio);
	return Math.hypot(projection.near, half.width, half.height);
}

function validatePerspectiveNearPlane(
	projection: PerspectiveNearPlane,
	aspectRatio: number,
): void {
	if (
		!Number.isFinite(projection.fov) ||
		projection.fov <= 0 ||
		projection.fov >= 180 ||
		!Number.isFinite(projection.near) ||
		projection.near <= 0 ||
		!Number.isFinite(aspectRatio) ||
		aspectRatio <= 0
	) {
		throw new Error(
			"Camera near-plane projection facts must be finite and positive.",
		);
	}
}
