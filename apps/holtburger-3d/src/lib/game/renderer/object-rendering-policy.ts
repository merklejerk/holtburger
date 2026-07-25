import type { StaticObjectDrawUnit } from "../commit/artifacts";
import { Vec3 } from "../math/types";

/** Retail-proven radius within which transparent static ranges sort back-to-front every frame. */
export const STATIC_TRANSPARENT_SORT_DISTANCE = 16;
/** Squared form used by the frame-time sorter; derived to avoid a duplicated threshold literal. */
export const STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED =
	STATIC_TRANSPARENT_SORT_DISTANCE * STATIC_TRANSPARENT_SORT_DISTANCE;

/** One transparent baked range paired with its center expressed in the current render frame. */
export interface TransparentStaticRange<T> {
	readonly range: T;
	readonly center: Vec3;
	readonly stableId: string;
}

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

/**
 * Keep far transparent ranges in their deterministic bake order, but sort nearby ranges
 * back-to-front. Stable identifiers make equal-distance output deterministic.
 */
export function sortTransparentStaticRanges<T>(
	ranges: readonly TransparentStaticRange<T>[],
	cameraPosition: Vec3,
): readonly TransparentStaticRange<T>[] {
	return ranges
		.map((range, index) => ({ index, range }))
		.sort((left, right) => {
		const leftDistance = distanceSquared(left.range.center, cameraPosition);
		const rightDistance = distanceSquared(right.range.center, cameraPosition);
		const leftNear = leftDistance <= STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED;
		const rightNear = rightDistance <= STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED;
		if (leftNear && rightNear && leftDistance !== rightDistance) {
			return rightDistance - leftDistance;
		}
		if (leftNear && rightNear) {
			return left.range.stableId.localeCompare(right.range.stableId);
		}
		return left.index - right.index;
	})
		.map(({ range }) => range);
}

/** Narrow a draw unit to its transparent sort facts without exposing renderer policy upstream. */
export function transparentSortFacts(
	drawUnit: StaticObjectDrawUnit,
): { readonly center: Vec3; readonly stableId: string } | null {
	return drawUnit.ordering === "transparent" ? drawUnit.transparentSort : null;
}

function distanceSquared(left: Vec3, right: Vec3): number {
	const x = left.x - right.x;
	const y = left.y - right.y;
	const z = left.z - right.z;
	return x * x + y * y + z * z;
}
