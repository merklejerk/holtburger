import type { PortalScopeWindowCullerCapacity } from "./portal-scope-window-culler";
import {
	PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT,
	PORTAL_ROOT_WINDOW_VERTEX_COUNT,
} from "./portal-window-arena";

/** Independent limits selected from Gate C and the archive-wide authored-geometry census. */
export interface PortalRenderCapacityLimits {
	/** Archive-wide maximum authored source-aperture vertex count. */
	readonly maximumAuthoredApertureVertexCount: number;
	/** Complete portal frontier rounds accepted by Gate C. */
	readonly maximumPathDepth: number;
	/** Checked projection/admission operations accepted in one camera plan. */
	readonly maximumProjectionPrimitiveCount: number;
	/** Root plus admitted scope-window deltas accepted in one camera plan. */
	readonly maximumScopeWindowWorkItemCount: number;
}

/** One production owner for traversal limits and their mechanically derived arena dimensions. */
export interface PortalRenderCapacityPolicy extends PortalRenderCapacityLimits {
	/** Exact fixed-capacity contract consumed by the arena-backed CPU culler. */
	readonly culler: PortalScopeWindowCullerCapacity;
}

/**
 * Derive storage from independently bounded work instead of selecting each backing array by feel.
 *
 * Every non-root committed or temporary polygon vertex is created or visited by the atomic
 * projection meter before it is appended. The root contributes four unmetered vertices. A convex
 * aperture can gain at most one vertex per homogeneous clip plane, and each crossing can add that
 * many half-plane boundaries to an inherited convex fragment.
 */
export function createPortalRenderCapacityPolicy(
	limits: PortalRenderCapacityLimits,
): PortalRenderCapacityPolicy {
	validateLimits(limits);
	// A reciprocal intersection can retain both input boundaries plus one crossing per edge pair.
	const maximumVisibilityApertureVertexCount =
		limits.maximumAuthoredApertureVertexCount ** 2 +
		2 * limits.maximumAuthoredApertureVertexCount;
	const maximumProjectedApertureFragmentVertexCount =
		maximumVisibilityApertureVertexCount + PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT;
	const maximumVerticesPerFragment =
		PORTAL_ROOT_WINDOW_VERTEX_COUNT +
		limits.maximumPathDepth * maximumProjectedApertureFragmentVertexCount;
	const maximumMeteredFragmentCount = Math.floor(
		limits.maximumProjectionPrimitiveCount / 3,
	);
	const maximumWindowCount = Math.max(
		1,
		limits.maximumScopeWindowWorkItemCount * 2 - 2,
	);
	const culler = Object.freeze({
		maximumDepth: limits.maximumPathDepth,
		maximumProjectionPrimitiveCount: limits.maximumProjectionPrimitiveCount,
		maximumWorkItemCount: limits.maximumScopeWindowWorkItemCount,
		windowArena: Object.freeze({
			maximumApertureVertexCount: maximumVisibilityApertureVertexCount,
			maximumFragmentCount: 1 + maximumMeteredFragmentCount,
			maximumTemporaryFragmentCount: Math.max(1, maximumMeteredFragmentCount),
			maximumTemporaryVertexCount: Math.max(
				PORTAL_ROOT_WINDOW_VERTEX_COUNT,
				limits.maximumProjectionPrimitiveCount,
				maximumVerticesPerFragment,
			),
			maximumVertexCount:
				PORTAL_ROOT_WINDOW_VERTEX_COUNT +
				limits.maximumProjectionPrimitiveCount,
			maximumVerticesPerFragment,
			maximumWindowCount,
		}),
	}) satisfies PortalScopeWindowCullerCapacity;
	return Object.freeze({ ...limits, culler });
}

function validateLimits(limits: PortalRenderCapacityLimits): void {
	for (const [name, value, minimum] of [
		[
			"maximumAuthoredApertureVertexCount",
			limits.maximumAuthoredApertureVertexCount,
			3,
		],
		["maximumPathDepth", limits.maximumPathDepth, 0],
		[
			"maximumProjectionPrimitiveCount",
			limits.maximumProjectionPrimitiveCount,
			1,
		],
		[
			"maximumScopeWindowWorkItemCount",
			limits.maximumScopeWindowWorkItemCount,
			1,
		],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum) {
			throw new Error(
				`Portal render capacity ${name} must be an integer at least ${minimum}.`,
			);
		}
	}
}

/** Gate C limits backed by the 2026-08-09 archive trace and aperture census. */
export const PORTAL_RENDER_CAPACITY_POLICY = createPortalRenderCapacityPolicy({
	maximumAuthoredApertureVertexCount: 24,
	maximumPathDepth: 16,
	maximumProjectionPrimitiveCount: 240_181,
	maximumScopeWindowWorkItemCount: 8_700,
});
