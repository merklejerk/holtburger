import { createLandblockWorldOrigin } from "../landblocks";
import type { AABB3, Mat4 } from "../math/types";
import { Vec3 } from "../math/types";
import type { DynamicEntitySelectionGeometry } from "../systems/dynamic-entity-system";
import type { LocalSelectionSphere } from "./entity-interaction-shape";

/** Unit world-space ray in render axes; its parameter is distance in metres. */
export interface PresentedSelectionRay {
	readonly start: Vec3;
	readonly direction: Vec3;
}

/** Narrow runtime lookup needed by app-local exact selection. */
export interface EntitySelectionGeometrySource {
	withSpawnedEntitySelectionGeometry<T>(
		guid: number,
		visit: (geometry: EntitySelectionGeometry) => T,
	): T | null;
}

/** Runtime-resolved interaction shape borrowed for one exact query. */
export type EntitySelectionGeometry =
	| ({ readonly kind: "triangles" } & DynamicEntitySelectionGeometry)
	| {
			readonly kind: "sphere-proxy";
			readonly landblockId: DynamicEntitySelectionGeometry["landblockId"];
			readonly sourceToLandblock: Mat4;
			readonly sphere: LocalSelectionSphere;
	  };

/** Nearest exact browser hit after current-pose refinement. */
export interface EntitySelectionRefinement {
	readonly selectedGuid: number | null;
	readonly distance: number | null;
}

/** Refine host candidates against current posed drawing triangles, then distance and GUID. */
export function refineEntitySelectionCandidates(
	source: EntitySelectionGeometrySource,
	ray: PresentedSelectionRay,
	candidateGuids: readonly number[],
	staticLimitDistance: number,
): EntitySelectionRefinement {
	validateRay(ray, staticLimitDistance);
	let selectedGuid: number | null = null;
	let selectedDistance = staticLimitDistance;
	for (const guid of candidateGuids) {
		const hit = source.withSpawnedEntitySelectionGeometry(guid, (geometry) => {
			const origin = createLandblockWorldOrigin(geometry.landblockId);
			const localRay = {
				direction: ray.direction,
				start: new Vec3(
					ray.start.x - origin.x,
					ray.start.y - origin.y,
					ray.start.z - origin.z,
				),
			};
			if (geometry.kind === "sphere-proxy") {
				const sphereRay = inverseTransformRay(
					geometry.sourceToLandblock,
					localRay,
				);
				return sphereRay === null
					? null
					: raySphereDistance(sphereRay, geometry.sphere, selectedDistance);
			}
			let closest: number | null = null;
			for (const part of geometry.parts) {
				const partRay = inverseTransformRay(part.sourceToLandblock, localRay);
				if (
					partRay === null ||
					!rayIntersectsAabb(partRay, part.localBounds, selectedDistance)
				)
					continue;
				for (const range of part.ranges) {
					const end = range.indexStart + range.indexCount;
					for (let offset = range.indexStart; offset < end; offset += 3) {
						const distance = indexedRayTriangleDistance(
							partRay,
							part.geometry.positions,
							part.geometry.indices,
							offset,
							range.cullFace,
						);
						if (
							distance !== null &&
							distance <= selectedDistance &&
							(closest === null || distance < closest)
						)
							closest = distance;
					}
				}
			}
			return closest;
		});
		if (
			hit !== null &&
			(hit < selectedDistance ||
				(hit === selectedDistance &&
					(selectedGuid === null || guid < selectedGuid)))
		) {
			selectedDistance = hit;
			selectedGuid = guid;
		}
	}
	return {
		distance: selectedGuid === null ? null : selectedDistance,
		selectedGuid,
	};
}

/** Intersect a local sphere while preserving the inverse-transformed ray's world-distance scalar. */
function raySphereDistance(
	ray: Ray,
	sphere: LocalSelectionSphere,
	maximumDistance: number,
): number | null {
	const ox = ray.start.x - sphere.center.x;
	const oy = ray.start.y - sphere.center.y;
	const oz = ray.start.z - sphere.center.z;
	const a =
		ray.direction.x * ray.direction.x +
		ray.direction.y * ray.direction.y +
		ray.direction.z * ray.direction.z;
	const halfB =
		ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z;
	const c = ox * ox + oy * oy + oz * oz - sphere.radius * sphere.radius;
	const discriminant = halfB * halfB - a * c;
	if (discriminant < 0 || !Number.isFinite(discriminant)) return null;
	const root = Math.sqrt(discriminant);
	const near = (-halfB - root) / a;
	const far = (-halfB + root) / a;
	const distance = near >= 0 ? near : far >= 0 ? far : null;
	return distance !== null && distance <= maximumDistance ? distance : null;
}

interface Ray {
	readonly start: Vec3;
	readonly direction: Vec3;
}

interface LocalRay extends Ray {
	/** Negative-scale parity reverses the winding observed by WebGL after transformation. */
	readonly reversesOrientation: boolean;
}

/** Inverse-transform a ray without normalizing direction, preserving its world-distance parameter. */
export function inverseTransformRay(
	transform: Mat4,
	ray: Ray,
): LocalRay | null {
	const a = transform.m11;
	const b = transform.m21;
	const c = transform.m31;
	const d = transform.m12;
	const e = transform.m22;
	const f = transform.m32;
	const g = transform.m13;
	const h = transform.m23;
	const i = transform.m33;
	const determinant =
		a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON)
		return null;
	const inverseDeterminant = 1 / determinant;
	const inverse = [
		(e * i - f * h) * inverseDeterminant,
		(c * h - b * i) * inverseDeterminant,
		(b * f - c * e) * inverseDeterminant,
		(f * g - d * i) * inverseDeterminant,
		(a * i - c * g) * inverseDeterminant,
		(c * d - a * f) * inverseDeterminant,
		(d * h - e * g) * inverseDeterminant,
		(b * g - a * h) * inverseDeterminant,
		(a * e - b * d) * inverseDeterminant,
	] as const;
	const relativeStart = new Vec3(
		ray.start.x - transform.m41,
		ray.start.y - transform.m42,
		ray.start.z - transform.m43,
	);
	return {
		start: multiplyInverse(inverse, relativeStart),
		direction: multiplyInverse(inverse, ray.direction),
		reversesOrientation: determinant < 0,
	};
}

/** Slab test in the same distance parameter as the unnormalized inverse-transformed ray. */
function rayIntersectsAabb(
	ray: Ray,
	bounds: AABB3,
	maximumDistance: number,
): boolean {
	let entry = 0;
	let exit = maximumDistance;
	for (const [start, direction, minimum, maximum] of [
		[ray.start.x, ray.direction.x, bounds.min.x, bounds.max.x],
		[ray.start.y, ray.direction.y, bounds.min.y, bounds.max.y],
		[ray.start.z, ray.direction.z, bounds.min.z, bounds.max.z],
	] as const) {
		if (Math.abs(direction) <= Number.EPSILON) {
			if (start < minimum || start > maximum) return false;
			continue;
		}
		const first = (minimum - start) / direction;
		const second = (maximum - start) / direction;
		entry = Math.max(entry, Math.min(first, second));
		exit = Math.min(exit, Math.max(first, second));
		if (entry > exit) return false;
	}
	return true;
}

/** Intersect one indexed authored triangle while honoring the renderer's effective cull face. */
export function indexedRayTriangleDistance(
	ray: LocalRay,
	positions: Float32Array,
	indices: Uint16Array | Uint32Array,
	indexOffset: number,
	cullFace: "back" | "front",
): number | null {
	const ia = indices[indexOffset];
	const ib = indices[indexOffset + 1];
	const ic = indices[indexOffset + 2];
	if (ia === undefined || ib === undefined || ic === undefined)
		throw new Error(`Triangle at index offset ${indexOffset} is incomplete.`);
	const ax = positions[ia * 3];
	const ay = positions[ia * 3 + 1];
	const az = positions[ia * 3 + 2];
	const bx = positions[ib * 3];
	const by = positions[ib * 3 + 1];
	const bz = positions[ib * 3 + 2];
	const cx = positions[ic * 3];
	const cy = positions[ic * 3 + 1];
	const cz = positions[ic * 3 + 2];
	if ([ax, ay, az, bx, by, bz, cx, cy, cz].some((value) => value === undefined))
		throw new Error(
			`Triangle at index offset ${indexOffset} names a missing vertex.`,
		);
	const edge1x = bx - ax;
	const edge1y = by - ay;
	const edge1z = bz - az;
	const edge2x = cx - ax;
	const edge2y = cy - ay;
	const edge2z = cz - az;
	const px = ray.direction.y * edge2z - ray.direction.z * edge2y;
	const py = ray.direction.z * edge2x - ray.direction.x * edge2z;
	const pz = ray.direction.x * edge2y - ray.direction.y * edge2x;
	const determinant = edge1x * px + edge1y * py + edge1z * pz;
	const epsilon = 1e-9;
	const effectiveCullFace = ray.reversesOrientation
		? cullFace === "back"
			? "front"
			: "back"
		: cullFace;
	if (
		(effectiveCullFace === "back" && determinant <= epsilon) ||
		(effectiveCullFace === "front" && determinant >= -epsilon)
	)
		return null;
	const inverseDeterminant = 1 / determinant;
	const tx = ray.start.x - ax;
	const ty = ray.start.y - ay;
	const tz = ray.start.z - az;
	const u = (tx * px + ty * py + tz * pz) * inverseDeterminant;
	if (u < 0 || u > 1) return null;
	const qx = ty * edge1z - tz * edge1y;
	const qy = tz * edge1x - tx * edge1z;
	const qz = tx * edge1y - ty * edge1x;
	const v =
		(ray.direction.x * qx + ray.direction.y * qy + ray.direction.z * qz) *
		inverseDeterminant;
	if (v < 0 || u + v > 1) return null;
	const distance =
		(edge2x * qx + edge2y * qy + edge2z * qz) * inverseDeterminant;
	return distance >= 0 && Number.isFinite(distance) ? distance : null;
}

function multiplyInverse(
	inverse: readonly [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	],
	vector: Vec3,
): Vec3 {
	return new Vec3(
		inverse[0] * vector.x + inverse[1] * vector.y + inverse[2] * vector.z,
		inverse[3] * vector.x + inverse[4] * vector.y + inverse[5] * vector.z,
		inverse[6] * vector.x + inverse[7] * vector.y + inverse[8] * vector.z,
	);
}

function validateRay(
	ray: PresentedSelectionRay,
	maximumDistance: number,
): void {
	const values = [
		ray.start.x,
		ray.start.y,
		ray.start.z,
		ray.direction.x,
		ray.direction.y,
		ray.direction.z,
		maximumDistance,
	];
	if (!values.every(Number.isFinite) || maximumDistance < 0)
		throw new Error(
			"Selection ray must contain finite coordinates and a nonnegative limit.",
		);
	const length = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
	if (Math.abs(length - 1) > 1e-6)
		throw new Error(
			"Selection ray direction must be normalized in world space.",
		);
}
