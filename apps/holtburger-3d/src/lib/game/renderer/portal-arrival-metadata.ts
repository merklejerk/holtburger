import type { ScenePortalCrossingInput } from "../scene";
import {
	PORTAL_QUERY_EPSILON,
	type PlanarAperturePlane,
} from "../scene/planar-aperture";

/** Zero is uncovered; every nonzero R8UI value identifies one retained arrival state. */
export const PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT = 0xff;

/** std140-compatible bytes reserved for one arrival plane and one integer routing vector. */
export const PORTAL_ARRIVAL_METADATA_RECORD_BYTES = 32;
/** Fixed CPU/GPU bytes for every nonzero R8UI arrival-state record. */
export const PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES =
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT * PORTAL_ARRIVAL_METADATA_RECORD_BYTES;
/** Float slots occupied by the oriented anchor-space plane at the start of one record. */
export const PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT = 4;
/** Byte offset of the destination-scope ordinal in one std140 routing vector. */
export const PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES = 16;
/** Byte offset of the explicitly suppressed reciprocal arrival id. */
export const PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES = 20;
/** Byte offset of the bit field distinguishing root from crossing arrivals. */
export const PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES = 24;
/** Record flag indicating that the float vector contains an entry plane. */
export const PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE = 1;

/**
 * Write an anchor-space plane whose positive half-space lies beyond the directed entry aperture.
 *
 * Aperture planes use landblock-local coordinates. Translating into the anchor frame adjusts only
 * `d`; orienting away from the crossing's accepted camera side makes one shader predicate serve
 * both authored normal directions. The caller owns and reuses `target`.
 */
export function writeOrientedPortalArrivalPlane(
	target: Float32Array,
	floatOffset: number,
	plane: PlanarAperturePlane,
	acceptedSide: ScenePortalCrossingInput["acceptedSide"],
	landblockOffsetX: number,
	landblockOffsetZ: number,
): void {
	if (
		!Number.isInteger(floatOffset) ||
		floatOffset < 0 ||
		floatOffset + PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT > target.length
	) {
		throw new Error("Portal arrival plane exceeds its metadata target.");
	}
	if (
		!Number.isFinite(landblockOffsetX) ||
		!Number.isFinite(landblockOffsetZ)
	) {
		throw new Error("Portal arrival plane landblock offset must be finite.");
	}
	const direction = acceptedSide === "positive" ? -1 : 1;
	target[floatOffset] = direction * plane.normal.x;
	target[floatOffset + 1] = direction * plane.normal.y;
	target[floatOffset + 2] = direction * plane.normal.z;
	target[floatOffset + 3] =
		direction *
		(plane.d -
			plane.normal.x * landblockOffsetX -
			plane.normal.z * landblockOffsetZ);
}

/** Evaluate one packed oriented plane at an anchor-space point without constructing vectors. */
export function portalArrivalPlaneDistance(
	metadata: Float32Array,
	floatOffset: number,
	x: number,
	y: number,
	z: number,
): number {
	return (
		metadata[floatOffset]! * x +
		metadata[floatOffset + 1]! * y +
		metadata[floatOffset + 2]! * z +
		metadata[floatOffset + 3]!
	);
}

/** Match portal-query tolerance while requiring the outgoing point to lie beyond the entry. */
export function portalArrivalPlaneContainsBeyondPoint(
	metadata: Float32Array,
	floatOffset: number,
	x: number,
	y: number,
	z: number,
): boolean {
	return (
		portalArrivalPlaneDistance(metadata, floatOffset, x, y, z) >
		PORTAL_QUERY_EPSILON
	);
}
