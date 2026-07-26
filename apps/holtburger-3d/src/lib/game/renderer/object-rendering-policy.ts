/** Retail-proven radius within which transparent static ranges sort back-to-front every frame. */
export const STATIC_TRANSPARENT_SORT_DISTANCE = 16;
/** Squared form used by the frame-time sorter; derived to avoid a duplicated threshold literal. */
export const STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED =
	STATIC_TRANSPARENT_SORT_DISTANCE * STATIC_TRANSPARENT_SORT_DISTANCE;

/** One transparent baked range paired with its current-frame camera distance. */
export interface TransparentStaticRange<T> {
	/** Precomputed squared camera distance; avoids per-comparison coordinate work and allocations. */
	readonly distanceSquared: number;
	readonly range: T;
	readonly stableId: string;
}

/** Far batchable and near distance-ordered transparent phases for one view. */
export interface OrderedTransparentStaticRanges<T> {
	/** Candidates outside the near-sort radius, ordered for deterministic draw compatibility. */
	readonly far: readonly TransparentStaticRange<T>[];
	/** Candidates inside the near-sort radius, ordered back-to-front. */
	readonly near: readonly TransparentStaticRange<T>[];
}

/** One phase-ordered transparent submission after adjacent frame cohorts are identified. */
export type TransparentStaticSubmission<T> =
	| { readonly kind: "single"; readonly value: T }
	| { readonly kind: "frame-instance-run"; readonly values: readonly T[] };

/** Renderer-private blend state derived from retail `D3DPolyRender::SetSurface` facts. */
export interface ObjectBlendPolicy {
	readonly source: "one" | "src-alpha" | "one-minus-src-alpha";
	readonly destination: "one" | "src-alpha" | "one-minus-src-alpha";
}

const SURFACE_ALPHA = 0x100;
const SURFACE_INVERSE_ALPHA = 0x200;
const SURFACE_ADDITIVE = 0x10000;

/** Compile transparent and additive source flags without leaking WebGL constants upstream. */
export function objectBlendPolicy(rawSurfaceFlags: number): ObjectBlendPolicy {
	const additive = (rawSurfaceFlags & SURFACE_ADDITIVE) !== 0;
	const alpha = (rawSurfaceFlags & SURFACE_ALPHA) !== 0;
	const inverseAlpha = (rawSurfaceFlags & SURFACE_INVERSE_ALPHA) !== 0;
	if (alpha) {
		return additive
			? { destination: "one", source: "src-alpha" }
			: { destination: "one-minus-src-alpha", source: "src-alpha" };
	}
	if (inverseAlpha) {
		return additive
			? { destination: "one", source: "one-minus-src-alpha" }
			: { destination: "src-alpha", source: "one-minus-src-alpha" };
	}
	return additive
		? { destination: "one", source: "one" }
		: { destination: "one-minus-src-alpha", source: "src-alpha" };
}

/** Partition one view's transparency and independently order its batchable far and sorted near phases. */
export function orderTransparentStaticRanges<T>(
	ranges: readonly TransparentStaticRange<T>[],
	compareFarForBatching: (left: T, right: T) => number,
): OrderedTransparentStaticRanges<T> {
	const far: TransparentStaticRange<T>[] = [];
	const near: TransparentStaticRange<T>[] = [];
	for (const range of ranges) {
		(range.distanceSquared <= STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED
			? near
			: far
		).push(range);
	}
	far.sort((left, right) => {
		const batchingOrder = compareFarForBatching(left.range, right.range);
		return batchingOrder !== 0
			? batchingOrder
			: left.stableId.localeCompare(right.stableId);
	});
	near.sort((left, right) => {
		const distanceOrder = right.distanceSquared - left.distanceSquared;
		return distanceOrder !== 0
			? distanceOrder
			: left.stableId.localeCompare(right.stableId);
	});
	return { far, near };
}

/**
 * Form frame-instance runs only after phase ordering, leaving every non-frame value as a barrier.
 */
export function formAdjacentTransparentInstanceRuns<T>(
	ordered: readonly T[],
	isFrameInstance: (value: T) => boolean,
	isCompatible: (left: T, right: T) => boolean,
): readonly TransparentStaticSubmission<T>[] {
	const submissions: TransparentStaticSubmission<T>[] = [];
	for (const value of ordered) {
		if (!isFrameInstance(value)) {
			submissions.push({ kind: "single", value });
			continue;
		}
		const previous = submissions.at(-1);
		if (
			previous?.kind === "frame-instance-run" &&
			isCompatible(previous.values[previous.values.length - 1]!, value)
		) {
			submissions[submissions.length - 1] = {
				kind: "frame-instance-run",
				values: [...previous.values, value],
			};
			continue;
		}
		submissions.push({ kind: "frame-instance-run", values: [value] });
	}
	return submissions;
}
