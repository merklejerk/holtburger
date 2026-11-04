import {
	subtractVec3 as subtract,
	scaleVec3 as scale,
	dotVec3 as dot,
	crossVec3 as cross,
} from "../math/vector-utils";
import { transformPoint3 } from "../math/matrices";
import type { FrustumPlane } from "../math/frustum";
import { Vec3, type AABB3, type Mat4 } from "../math/types";

/** Boundary polygons of one clipped box; degenerate results may be lines or points. */
type BoxFaces = readonly (readonly Vec3[])[];

/** Nearest squared distance to the part volume after all inward half-space restrictions. */
export function selectionBoxDistanceSquared(
	bounds: AABB3,
	transform: Mat4,
	point: Vec3,
	planes: readonly FrustumPlane[],
): number | null {
	const vertex = (x: number, y: number, z: number) =>
		transformPoint3(transform, new Vec3(x, y, z));
	const a = vertex(bounds.min.x, bounds.min.y, bounds.min.z);
	const b = vertex(bounds.min.x, bounds.min.y, bounds.max.z);
	const c = vertex(bounds.min.x, bounds.max.y, bounds.min.z);
	const d = vertex(bounds.min.x, bounds.max.y, bounds.max.z);
	const e = vertex(bounds.max.x, bounds.min.y, bounds.min.z);
	const f = vertex(bounds.max.x, bounds.min.y, bounds.max.z);
	const g = vertex(bounds.max.x, bounds.max.y, bounds.min.z);
	const h = vertex(bounds.max.x, bounds.max.y, bounds.max.z);
	const corners = [a, b, c, d, e, f, g, h];
	if (
		[
			bounds.min.x > bounds.max.x,
			bounds.min.y > bounds.max.y,
			bounds.min.z > bounds.max.z,
		].some(Boolean)
	)
		throw new Error("Selection box requires ordered bounds.");
	if (![point, ...corners].every(finitePoint))
		throw new Error(
			"Selection box query requires finite points and transformed bounds.",
		);
	if (
		!planes.every((plane) =>
			[plane.x, plane.y, plane.z, plane.constant].every(Number.isFinite),
		)
	)
		throw new Error(
			"Selection box restrictions require finite plane coefficients.",
		);
	if (!planes.every((plane) => Math.hypot(plane.x, plane.y, plane.z) > 0))
		throw new Error(
			"Selection box restrictions require non-degenerate planes.",
		);
	const originalFaces = [
		[a, b, d, c],
		[e, g, h, f],
		[a, e, f, b],
		[c, d, h, g],
		[a, c, g, e],
		[b, f, h, d],
	] as const;
	let faces: BoxFaces = originalFaces;
	const center = scale(a.add(h), 0.5);
	// Collapsed boxes have no 3D interior; their faces still cover the lower-dimensional volume.
	const determinant = dot(
		subtract(e, a),
		cross(subtract(c, a), subtract(b, a)),
	);
	const inside =
		determinant !== 0 &&
		originalFaces.every(([first, second, third]) => {
			const normal = cross(subtract(second, first), subtract(third, first));
			return (
				dot(normal, subtract(point, first)) *
					dot(normal, subtract(center, first)) >=
				0
			);
		});
	if (inside && planes.every((plane) => planeDistance(plane, point) >= 0))
		return 0;
	for (const plane of planes) {
		faces = clipFaces(faces, plane);
		if (faces.length === 0) return null;
	}
	let closest = Infinity;
	for (const face of faces) {
		const a = face[0];
		if (a === undefined) continue;
		closest = Math.min(closest, point.distanceSquaredTo(a));
		for (const [index, b] of face.entries()) {
			if (index === 0) continue;
			const c = face[index + 1];
			closest = Math.min(
				closest,
				c === undefined
					? segmentDistanceSquared(point, a, b)
					: triangleDistanceSquared(point, a, b, c),
			);
		}
	}
	return closest === Infinity ? null : closest;
}

/** Clip every boundary face, then close the introduced boundary with a cap polygon. */
function clipFaces(faces: BoxFaces, plane: FrustumPlane): BoxFaces {
	const clipped: Vec3[][] = [];
	const cap: Vec3[] = [];
	for (const face of faces) {
		const output: Vec3[] = [];
		let previous = face.at(-1);
		if (previous === undefined) continue;
		let previousDistance = planeDistance(plane, previous);
		for (const current of face) {
			const currentDistance = planeDistance(plane, current);
			if (previousDistance < 0 !== currentDistance < 0) {
				const fraction =
					previousDistance / (previousDistance - currentDistance);
				const intersection = previous.add(
					scale(subtract(current, previous), fraction),
				);
				output.push(intersection);
				appendDistinct(cap, intersection);
			}
			if (currentDistance >= 0) {
				output.push(current);
				if (currentDistance === 0) appendDistinct(cap, current);
			}
			previous = current;
			previousDistance = currentDistance;
		}
		if (output.length > 0) clipped.push(output);
	}
	if (cap.length > 0) {
		const center = scale(
			cap.reduce((total, point) => total.add(point), Vec3.zero()),
			1 / cap.length,
		);
		const normal = new Vec3(plane.x, plane.y, plane.z);
		const reference =
			Math.abs(normal.x) < Math.abs(normal.y)
				? new Vec3(1, 0, 0)
				: new Vec3(0, 1, 0);
		const right = cross(normal, reference);
		const up = cross(normal, right);
		cap.sort(
			(a, b) =>
				Math.atan2(
					dot(subtract(a, center), up),
					dot(subtract(a, center), right),
				) -
				Math.atan2(
					dot(subtract(b, center), up),
					dot(subtract(b, center), right),
				),
		);
		clipped.push(cap);
	}
	return clipped;
}

/** Dedupe only cap topology; do not snap coordinates or enlarge gameplay range boundaries. */
function appendDistinct(points: Vec3[], value: Vec3): void {
	const epsilon =
		Number.EPSILON *
		32 *
		Math.max(1, Math.abs(value.x), Math.abs(value.y), Math.abs(value.z));
	if (
		!points.some((point) => point.distanceSquaredTo(value) <= epsilon * epsilon)
	)
		points.push(value);
}

function triangleDistanceSquared(
	point: Vec3,
	a: Vec3,
	b: Vec3,
	c: Vec3,
): number {
	const normal = cross(subtract(b, a), subtract(c, a));
	const lengthSquared = dot(normal, normal);
	if (lengthSquared > 0) {
		const distance = dot(subtract(point, a), normal) / lengthSquared;
		const projected = subtract(point, scale(normal, distance));
		const edges = [
			[a, b],
			[b, c],
			[c, a],
		] as const;
		if (
			edges.every(([start, end]) => {
				return (
					dot(
						cross(subtract(end, start), subtract(projected, start)),
						normal,
					) >= 0
				);
			})
		)
			return point.distanceSquaredTo(projected);
	}
	return Math.min(
		segmentDistanceSquared(point, a, b),
		segmentDistanceSquared(point, b, c),
		segmentDistanceSquared(point, c, a),
	);
}

function segmentDistanceSquared(point: Vec3, a: Vec3, b: Vec3): number {
	const edge = subtract(b, a);
	const lengthSquared = dot(edge, edge);
	if (lengthSquared === 0) return point.distanceSquaredTo(a);
	const fraction = Math.max(
		0,
		Math.min(1, dot(subtract(point, a), edge) / lengthSquared),
	);
	return point.distanceSquaredTo(a.add(scale(edge, fraction)));
}

function planeDistance(plane: FrustumPlane, point: Vec3): number {
	return (
		plane.x * point.x + plane.y * point.y + plane.z * point.z + plane.constant
	);
}
function finitePoint(point: Vec3): boolean {
	return [point.x, point.y, point.z].every(Number.isFinite);
}
