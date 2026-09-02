import { mapEnvironment } from "../lib/game/map/map-view";
import type { MinimapSubject } from "./minimap-frame";
import type { MinimapBreadcrumbPolicy } from "./minimap-tuning";

/** One historical controlled-entity position retained for minimap presentation. */
export interface MinimapBreadcrumb {
	/** East-west world coordinate. */
	readonly worldX: number;
	/** World height used for anchor-relative breadcrumb shading. */
	readonly worldY: number;
	/** South-north world coordinate. */
	readonly worldZ: number;
}

/** Non-empty most-recent-first history; index zero is also the last recorded position. */
export type MinimapBreadcrumbHistory = readonly [
	MinimapBreadcrumb,
	...MinimapBreadcrumb[],
];

/** Transient history for the currently controlled entity, or no trackable subject. */
export type MinimapBreadcrumbTrail =
	| {
			/** No controlled entity is currently producing history. */
			readonly kind: "empty";
	  }
	| {
			/** A controlled entity is producing bounded position history. */
			readonly kind: "tracking";
			/** Identity that prevents history crossing possession or player changes. */
			readonly subjectGuid: number;
			/** Most recent frame observation, used only for discontinuity detection. */
			readonly lastObserved: MinimapBreadcrumb;
			/** Bounded recency-ordered samples; the first element is the last recorded position. */
			readonly samples: MinimapBreadcrumbHistory;
	  };

/** Shared zero-payload state while no controlled entity is available. */
export const EMPTY_MINIMAP_BREADCRUMB_TRAIL: MinimapBreadcrumbTrail = {
	kind: "empty",
};

/**
 * Observe one minimap subject and advance its bounded, distance-sampled history.
 *
 * Consecutive 3D displacement detects discontinuities independently from horizontal sample
 * spacing. Recency-first storage makes the last recorded position non-optional by construction,
 * refreshes already-covered space without spending capacity, and drops the oldest sample when a
 * novel position reaches capacity.
 */
export function observeMinimapBreadcrumbTrail(
	trail: MinimapBreadcrumbTrail,
	subject: MinimapSubject | null,
	policy: MinimapBreadcrumbPolicy,
): MinimapBreadcrumbTrail {
	if (subject?.kind !== "controlled-entity") {
		return trail.kind === "empty" ? trail : EMPTY_MINIMAP_BREADCRUMB_TRAIL;
	}
	const observed = breadcrumbFromSubject(subject);
	if (trail.kind === "empty" || trail.subjectGuid !== subject.guid) {
		return startTrail(subject.guid, observed);
	}
	if (samePosition(trail.lastObserved, observed)) return trail;

	const observationDistanceSquared = spatialDistanceSquared(
		trail.lastObserved,
		observed,
	);
	const maximumStepSquared = policy.maximumContinuousStepMeters ** 2;
	if (observationDistanceSquared > maximumStepSquared) {
		return startTrail(subject.guid, observed);
	}

	const lastRecorded = trail.samples[0];
	const sampleDistanceSquared = horizontalDistanceSquared(
		lastRecorded,
		observed,
	);
	const spacing = policy.spacingMeters[mapEnvironment(subject.anchor)];
	const spacingSquared = spacing * spacing;
	if (sampleDistanceSquared < spacingSquared) {
		return { ...trail, lastObserved: observed };
	}

	// Refresh every occupied location the candidate covers. Removing all collisions preserves the
	// spacing invariant even when the new position lies between multiple retained samples.
	const uncoveredSamples = trail.samples.filter(
		(sample) => spatialDistanceSquared(sample, observed) >= spacingSquared,
	);
	return {
		kind: "tracking",
		lastObserved: observed,
		samples: [
			observed,
			...uncoveredSamples.slice(0, policy.maximumSamples - 1),
		],
		subjectGuid: subject.guid,
	};
}

function startTrail(
	subjectGuid: number,
	observed: MinimapBreadcrumb,
): MinimapBreadcrumbTrail {
	return {
		kind: "tracking",
		lastObserved: observed,
		samples: [observed],
		subjectGuid,
	};
}

function breadcrumbFromSubject(
	subject: MinimapSubject & { readonly kind: "controlled-entity" },
): MinimapBreadcrumb {
	return {
		worldX: subject.anchor.worldX,
		worldY: subject.anchor.worldY,
		worldZ: subject.anchor.worldZ,
	};
}

function samePosition(
	left: MinimapBreadcrumb,
	right: MinimapBreadcrumb,
): boolean {
	return (
		left.worldX === right.worldX &&
		left.worldY === right.worldY &&
		left.worldZ === right.worldZ
	);
}

function horizontalDistanceSquared(
	left: MinimapBreadcrumb,
	right: MinimapBreadcrumb,
): number {
	const deltaX = right.worldX - left.worldX;
	const deltaZ = right.worldZ - left.worldZ;
	return deltaX * deltaX + deltaZ * deltaZ;
}

function spatialDistanceSquared(
	left: MinimapBreadcrumb,
	right: MinimapBreadcrumb,
): number {
	const deltaY = right.worldY - left.worldY;
	return horizontalDistanceSquared(left, right) + deltaY * deltaY;
}
