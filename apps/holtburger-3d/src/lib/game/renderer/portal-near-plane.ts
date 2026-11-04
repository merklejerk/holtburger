import type { Camera } from "../runtime/types";
import { Quat, Vec3 } from "../math/types";
import { resolveNearPlaneHalfExtents } from "../camera/projection-clearance";
import {
	type PlanarAperture,
	type PlanarAperturePlane,
	validatePlanarAperture,
} from "../scene/planar-aperture";

/** World-space contact band used only for renderer near-clip ownership decisions. */
export const NEAR_CLIP_CONTACT_EPSILON = 0.000_2;

/** Dimensionless collinearity threshold for constructing normalized clip planes. */
const DEGENERATE_PLANE_SINE = Number.EPSILON * 64;

/** Finite pyramid between the camera eye and its ordered near-plane corners. */
export interface CameraNearClipVolume {
	readonly clippingPlanes: readonly [
		PlanarAperturePlane,
		PlanarAperturePlane,
		PlanarAperturePlane,
		PlanarAperturePlane,
		PlanarAperturePlane,
	];
	readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
	readonly eye: Vec3;
}

/** Camera-dependent primitive dimensions consumed by near-clip aperture classification. */
export type CameraNearClipPrimitiveKind =
	| "apertureVertexReadCount"
	| "coordinateValidationCount"
	| "createdPolygonCount"
	| "createdVertexCount"
	| "indexValidationCount"
	| "triangleTestCount"
	| "vertexPlaneTestCount";

/** Checked operation sink shared with the planner's atomic projection budget. */
export interface CameraNearClipPrimitiveMeter {
	/** Charge a positive operation count before the associated work occurs. */
	consume(kind: CameraNearClipPrimitiveKind, count: number): void;
}

/** Build the exact finite near-clip pyramid in canonical world coordinates. */
export function createCameraNearClipVolume(
	camera: Pick<Camera, "fov" | "near">,
	/**
	 * Eye pose in whatever frame the caller's view matrix uses — anchor-relative in production.
	 *
	 * Taken separately rather than as a `CameraPlacement` because that type is canonical scene
	 * space, and the renderer was synthesizing one from an anchor-relative position to satisfy it.
	 * A plain `Vec3` is right here: the pose is consumed immediately and never retained, so it has
	 * no frame to get wrong across a boundary.
	 */
	pose: { readonly position: Vec3; readonly rotation: Quat },
	aspectRatio: number,
): CameraNearClipVolume {
	const { height: halfHeight, width: halfWidth } = resolveNearPlaneHalfExtents(
		camera,
		aspectRatio,
	);
	const localCorners = [
		new Vec3(-halfWidth, -halfHeight, -camera.near),
		new Vec3(halfWidth, -halfHeight, -camera.near),
		new Vec3(halfWidth, halfHeight, -camera.near),
		new Vec3(-halfWidth, halfHeight, -camera.near),
	] as const;
	const corners = localCorners.map((corner) =>
		rotateAndTranslate(corner, pose.rotation, pose.position),
	) as unknown as [Vec3, Vec3, Vec3, Vec3];
	const eye = pose.position;
	const interior = averagePoints([eye, ...corners]);
	return {
		clippingPlanes: [
			orientedPlane(corners[0], corners[1], corners[2], interior),
			orientedPlane(eye, corners[0], corners[1], interior),
			orientedPlane(eye, corners[1], corners[2], interior),
			orientedPlane(eye, corners[2], corners[3], interior),
			orientedPlane(eye, corners[3], corners[0], interior),
		],
		corners,
		eye,
	};
}

/**
 * Test aperture triangles against the finite pyramid between the camera eye and near-plane quad.
 *
 * The quad alone is insufficient: an oblique aperture can enter the clipped volume without
 * intersecting its far cap.
 */
export function apertureIntersectsCameraNearClipVolume(
	volume: CameraNearClipVolume,
	aperture: PlanarAperture,
): boolean {
	validatePlanarAperture(aperture);
	return intersectsPreparedCameraNearClipVolume(volume, aperture, null);
}

function intersectsPreparedCameraNearClipVolume(
	volume: CameraNearClipVolume,
	aperture: PlanarAperture,
	meter: CameraNearClipPrimitiveMeter | null,
): boolean {
	const points = readVertices(aperture, meter);
	for (let index = 0; index < aperture.indices.length; index += 3) {
		charge(meter, "triangleTestCount", 1);
		charge(meter, "createdPolygonCount", 1);
		let polygon = [
			points[aperture.indices[index]!]!,
			points[aperture.indices[index + 1]!]!,
			points[aperture.indices[index + 2]!]!,
		];
		for (const plane of volume.clippingPlanes) {
			polygon = clipPolygonToHalfSpace(polygon, plane, meter);
			if (polygon.length === 0) break;
		}
		if (polygon.length > 0) return true;
	}
	return false;
}

function readVertices(
	aperture: PlanarAperture,
	meter: CameraNearClipPrimitiveMeter | null,
): readonly Vec3[] {
	const points: Vec3[] = [];
	for (let index = 0; index < aperture.vertices.length; index += 3) {
		charge(meter, "apertureVertexReadCount", 1);
		charge(meter, "createdVertexCount", 1);
		points.push(
			new Vec3(
				aperture.vertices[index]!,
				aperture.vertices[index + 1]!,
				aperture.vertices[index + 2]!,
			),
		);
	}
	return points;
}

function averagePoints(points: readonly Vec3[]): Vec3 {
	const sum = points.reduce((result, point) => {
		if (
			!Number.isFinite(point.x) ||
			!Number.isFinite(point.y) ||
			!Number.isFinite(point.z)
		) {
			throw new Error("Camera near-clip volume contains a non-finite point.");
		}
		return new Vec3(result.x + point.x, result.y + point.y, result.z + point.z);
	}, Vec3.zero());
	return new Vec3(
		sum.x / points.length,
		sum.y / points.length,
		sum.z / points.length,
	);
}

/** Create a normalized plane whose retained half-space has non-positive distance. */
function orientedPlane(
	first: Vec3,
	second: Vec3,
	third: Vec3,
	interior: Vec3,
): PlanarAperturePlane {
	const firstEdge = subtract(second, first);
	const secondEdge = subtract(third, first);
	let normal = cross(firstEdge, secondEdge);
	const length = Math.hypot(normal.x, normal.y, normal.z);
	const edgeScale =
		Math.hypot(firstEdge.x, firstEdge.y, firstEdge.z) *
		Math.hypot(secondEdge.x, secondEdge.y, secondEdge.z);
	if (
		!Number.isFinite(length) ||
		!Number.isFinite(edgeScale) ||
		edgeScale === 0 ||
		length <= DEGENERATE_PLANE_SINE * edgeScale
	) {
		throw new Error("Camera near-clip volume contains a degenerate plane.");
	}
	normal = new Vec3(normal.x / length, normal.y / length, normal.z / length);
	let plane = { d: -dot(normal, first), normal };
	if (planeDistance(plane, interior) > 0) {
		normal = new Vec3(-normal.x, -normal.y, -normal.z);
		plane = { d: -dot(normal, first), normal };
	}
	return plane;
}

function clipPolygonToHalfSpace(
	polygon: readonly Vec3[],
	plane: PlanarAperturePlane,
	meter: CameraNearClipPrimitiveMeter | null,
): Vec3[] {
	charge(meter, "createdPolygonCount", 1);
	const clipped: Vec3[] = [];
	let previous = polygon.at(-1)!;
	charge(meter, "vertexPlaneTestCount", 1);
	let previousDistance = planeDistance(plane, previous);
	for (const current of polygon) {
		charge(meter, "vertexPlaneTestCount", 1);
		const currentDistance = planeDistance(plane, current);
		const previousInside = previousDistance <= NEAR_CLIP_CONTACT_EPSILON;
		const currentInside = currentDistance <= NEAR_CLIP_CONTACT_EPSILON;
		if (previousInside !== currentInside) {
			const fraction =
				(previousDistance - NEAR_CLIP_CONTACT_EPSILON) /
				(previousDistance - currentDistance);
			charge(meter, "createdVertexCount", 1);
			clipped.push(lerp(previous, current, fraction));
		}
		if (currentInside) clipped.push(current);
		previous = current;
		previousDistance = currentDistance;
	}
	return clipped;
}

function charge(
	meter: CameraNearClipPrimitiveMeter | null,
	kind: CameraNearClipPrimitiveKind,
	count: number,
): void {
	if (!Number.isSafeInteger(count) || count <= 0) {
		throw new Error(
			`Portal near-clip counter ${kind} received invalid count ${count}.`,
		);
	}
	meter?.consume(kind, count);
}

function planeDistance(plane: PlanarAperturePlane, point: Vec3): number {
	return dot(plane.normal, point) + plane.d;
}

function subtract(left: Vec3, right: Vec3): Vec3 {
	return new Vec3(left.x - right.x, left.y - right.y, left.z - right.z);
}

function cross(left: Vec3, right: Vec3): Vec3 {
	return new Vec3(
		left.y * right.z - left.z * right.y,
		left.z * right.x - left.x * right.z,
		left.x * right.y - left.y * right.x,
	);
}

function lerp(start: Vec3, end: Vec3, fraction: number): Vec3 {
	return new Vec3(
		start.x + (end.x - start.x) * fraction,
		start.y + (end.y - start.y) * fraction,
		start.z + (end.z - start.z) * fraction,
	);
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
