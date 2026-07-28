import { Vec3 } from "../math/types";
import {
	PORTAL_QUERY_EPSILON,
	intersectSegmentPlane,
	pointInTriangulatedAperture,
	signedPlaneDistance,
	type PlanarAperture,
} from "./planar-aperture";

/** One source-scope aperture expressed in the same local frame as the query segment. */
export interface DirectedApertureCandidate<TValue> {
	readonly acceptedSide: "positive" | "negative";
	readonly aperture: PlanarAperture;
	readonly end: Vec3;
	readonly id: string;
	readonly start: Vec3;
	readonly value: TValue;
}

/** Exact finite-aperture hit selected from a directed candidate. */
export interface DirectedApertureHit<TValue> {
	readonly id: string;
	readonly point: Vec3;
	readonly t: number;
	readonly value: TValue;
}

/**
 * Return every candidate tied at the earliest finite directed crossing.
 *
 * Ties are sorted by stable identity for deterministic diagnostics. Selection policy must inspect
 * the complete tie rather than silently treating the first identity as spatial authority.
 */
export function findEarliestDirectedApertureHits<TValue>(
	candidates: readonly DirectedApertureCandidate<TValue>[],
): readonly DirectedApertureHit<TValue>[] {
	const ids = new Set<string>();
	const hits: DirectedApertureHit<TValue>[] = [];
	let segmentLength = 0;
	for (const candidate of candidates) {
		if (ids.has(candidate.id)) {
			throw new Error(
				`Directed aperture query repeats candidate ${candidate.id}.`,
			);
		}
		ids.add(candidate.id);
		const candidateLength =
			candidate.start.distanceSquaredTo(candidate.end) ** 0.5;
		if (!Number.isFinite(candidateLength)) {
			throw new Error("Directed aperture query contains a non-finite segment.");
		}
		segmentLength = Math.max(segmentLength, candidateLength);
		const hit = directedApertureHit(candidate);
		if (hit) hits.push(hit);
	}
	if (hits.length === 0) return [];
	hits.sort(
		(left, right) => left.t - right.t || left.id.localeCompare(right.id),
	);
	const first = hits[0]!;
	const parameterTolerance =
		segmentLength === 0 ? 0 : PORTAL_QUERY_EPSILON / segmentLength;
	return hits
		.filter(({ t }) => t - first.t <= parameterTolerance)
		.sort((left, right) => left.id.localeCompare(right.id));
}

function directedApertureHit<TValue>(
	candidate: DirectedApertureCandidate<TValue>,
): DirectedApertureHit<TValue> | null {
	const multiplier = candidate.acceptedSide === "positive" ? 1 : -1;
	const startDistance =
		signedPlaneDistance(candidate.aperture.plane, candidate.start) * multiplier;
	const endDistance =
		signedPlaneDistance(candidate.aperture.plane, candidate.end) * multiplier;
	// Authoritative source residency permits a start within the boundary slab. The endpoint must
	// enter the target half-space beyond the slab so merely touching a portal never changes scope.
	if (
		startDistance < -PORTAL_QUERY_EPSILON ||
		endDistance >= -PORTAL_QUERY_EPSILON
	) {
		return null;
	}
	const intersection = intersectSegmentPlane(
		candidate.start,
		candidate.end,
		candidate.aperture.plane,
	);
	if (
		intersection.kind !== "point" ||
		!pointInTriangulatedAperture(intersection.point, candidate.aperture)
	) {
		return null;
	}
	return {
		id: candidate.id,
		point: intersection.point,
		t: intersection.t,
		value: candidate.value,
	};
}
