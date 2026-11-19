import type { Mat4, Vec3 } from "../../math/types";
import {
	ENTITY_OVERLAY_PRIORITY_RANK,
	type EntityOverlayPriority,
} from "./entity-overlay-policy";

/** Facts required for deterministic priority-then-nearest budget decisions. */
export interface RankedOverlayComponent {
	readonly distanceSquared: number;
	readonly identity: string;
	readonly priority: EntityOverlayPriority;
}

interface AnchoredOverlayComponent {
	readonly anchor: Vec3;
	readonly priority: EntityOverlayPriority;
}

/**
 * Camera-forward depth where an authored raster dimension projects to the legibility threshold.
 *
 * The billboard shader scales raster pixels by `referenceDistance / depth`; authored and minimum
 * sizes are both CSS pixels, so render density cancels out of this cutoff.
 */
export function maximumLegibleOverlayDepth(
	referenceDistance: number,
	authoredPixels: number,
	minimumLegiblePixels: number,
): number {
	return (referenceDistance * authoredPixels) / minimumLegiblePixels;
}

/**
 * Remove components behind the camera, and those whose projection falls below legibility.
 *
 * `focusBypassesLegibility` is a component policy: focus labels stay readable intent even when
 * tiny, while focus bars still need a visible projected height.
 */
export function retainLegibleOverlays<T extends AnchoredOverlayComponent>(
	candidates: T[],
	clipFromAnchor: Mat4,
	maximumDepth: number,
	focusBypassesLegibility: boolean,
): void {
	let retainedCount = 0;
	for (const candidate of candidates) {
		const { anchor } = candidate;
		// This is the exact homogeneous W computed by the vertex shader. For our perspective
		// projection it is positive camera-forward depth, which directly controls pixel scale.
		const depth =
			clipFromAnchor.m14 * anchor.x +
			clipFromAnchor.m24 * anchor.y +
			clipFromAnchor.m34 * anchor.z +
			clipFromAnchor.m44;
		const bypass = focusBypassesLegibility && candidate.priority === "focus";
		if (depth <= 0 || (!bypass && depth > maximumDepth)) continue;
		candidates[retainedCount] = candidate;
		retainedCount += 1;
	}
	candidates.length = retainedCount;
}

/**
 * Retain every focus component plus the nearest ordinary budget, alerts before ambient, then
 * reorder back-to-front for alpha blending.
 */
export function retainOverlayBudget<T extends RankedOverlayComponent>(
	candidates: T[],
	maximumVisible: number,
): void {
	if (!Number.isSafeInteger(maximumVisible) || maximumVisible < 0)
		throw new Error("Overlay budget must be a nonnegative safe integer.");
	candidates.sort(
		(left, right) =>
			ENTITY_OVERLAY_PRIORITY_RANK[left.priority] -
				ENTITY_OVERLAY_PRIORITY_RANK[right.priority] ||
			left.distanceSquared - right.distanceSquared ||
			left.identity.localeCompare(right.identity),
	);
	const firstOrdinary = candidates.findIndex(
		(candidate) => candidate.priority !== "focus",
	);
	const focusCount = firstOrdinary < 0 ? candidates.length : firstOrdinary;
	candidates.length = Math.min(candidates.length, focusCount + maximumVisible);
	// Admission priority must not become blend order: a distant focus component is still behind.
	candidates.sort(
		(left, right) =>
			right.distanceSquared - left.distanceSquared ||
			right.identity.localeCompare(left.identity),
	);
}

/** One admitted component's entity reference; components of one entity share it by identity. */
interface ComposableOverlayEntity {
	readonly distanceSquared: number;
	readonly identity: string;
}

/** One entity's surviving components composed into a single nonempty draw. */
export interface ComposedEntityOverlay<TEntity, TLabel> {
	readonly entity: TEntity;
	/** Surviving label, or null for a bar-only overlay. */
	readonly label: TLabel | null;
	/** Surviving health fraction, or null for a label-only overlay. */
	readonly healthFraction: number | null;
}

/**
 * Join independently admitted labels and bars per entity, after both admissions, in
 * back-to-front blend order. Layout is resolved here: neither component reserves space for the
 * other unless both survive.
 */
export function composeEntityOverlays<
	TEntity extends ComposableOverlayEntity,
	TLabel,
>(
	labels: readonly { readonly entity: TEntity; readonly label: TLabel }[],
	bars: readonly { readonly entity: TEntity; readonly fraction: number }[],
): ComposedEntityOverlay<TEntity, TLabel>[] {
	const composed = new Map<
		TEntity,
		{ entity: TEntity; label: TLabel | null; healthFraction: number | null }
	>();
	for (const { entity, label } of labels)
		composed.set(entity, { entity, label, healthFraction: null });
	for (const { entity, fraction } of bars) {
		const existing = composed.get(entity);
		if (existing === undefined)
			composed.set(entity, { entity, label: null, healthFraction: fraction });
		else existing.healthFraction = fraction;
	}
	return [...composed.values()].sort(
		(left, right) =>
			right.entity.distanceSquared - left.entity.distanceSquared ||
			right.entity.identity.localeCompare(left.entity.identity),
	);
}
