import type { PortalScopeWindowCullerCapacity } from "./portal-scope-window-culler";
import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";
import {
	PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT,
	PORTAL_ROOT_WINDOW_VERTEX_COUNT,
} from "./portal-window-arena";

/** Independent limits selected from Gate C and the archive-wide authored-geometry census. */
interface PortalRenderCapacityLimits {
	/** Archive-wide maximum authored source-aperture vertex count. */
	readonly maximumAuthoredApertureVertexCount: number;
	/** Complete portal frontier rounds accepted by Gate C. */
	readonly maximumPathDepth: number;
	/** Checked projection/admission operations accepted in one camera plan. */
	readonly maximumProjectionPrimitiveCount: number;
	/** Root plus admitted scope-window deltas accepted in one camera plan. */
	readonly maximumScopeWindowWorkItemCount: number;
}

/** Fixed GPU scope-atlas and arrival-state capacity selected from symbolic traces. */
interface PortalScopeAtlasCapacitySelection {
	/** Horizontal drawing-buffer tiles allocated once per target generation. */
	readonly columnCount: number;
	/** Expanded aperture triangle vertices uploaded once for all retained crossings. */
	readonly maximumCrossingTriangleVertexCount: number;
	/** Root plus directed-crossing arrival ids representable by the frontier format. */
	readonly maximumArrivalStateCount: number;
	/** Complete fixed attachment bytes admitted for one drawing-buffer generation. */
	readonly maximumTargetByteLength: number;
	/** Vertical drawing-buffer tiles allocated once per target generation. */
	readonly rowCount: number;
}

/** Independently selected inputs for CPU traversal and GPU scope-atlas capacity. */
export interface PortalRenderCapacitySelection extends PortalRenderCapacityLimits {
	/** Trace-selected fixed GPU capacity; exhaustion declines a complete portal frontier. */
	readonly scopeAtlas: PortalScopeAtlasCapacitySelection;
}

/** One production owner for selected limits and their mechanically derived arena dimensions. */
export interface PortalRenderCapacityPolicy extends PortalRenderCapacitySelection {
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
	selection: PortalRenderCapacitySelection,
): PortalRenderCapacityPolicy {
	validateSelection(selection);
	// A reciprocal intersection can retain both input boundaries plus one crossing per edge pair.
	const maximumVisibilityApertureVertexCount =
		selection.maximumAuthoredApertureVertexCount ** 2 +
		2 * selection.maximumAuthoredApertureVertexCount;
	const maximumProjectedApertureFragmentVertexCount =
		maximumVisibilityApertureVertexCount + PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT;
	const maximumVerticesPerFragment =
		PORTAL_ROOT_WINDOW_VERTEX_COUNT +
		selection.maximumPathDepth * maximumProjectedApertureFragmentVertexCount;
	const maximumMeteredFragmentCount = Math.floor(
		selection.maximumProjectionPrimitiveCount / 3,
	);
	const maximumWindowCount = Math.max(
		1,
		selection.maximumScopeWindowWorkItemCount * 2 - 2,
	);
	const culler = Object.freeze({
		maximumDepth: selection.maximumPathDepth,
		maximumProjectionPrimitiveCount: selection.maximumProjectionPrimitiveCount,
		maximumWorkItemCount: selection.maximumScopeWindowWorkItemCount,
		windowArena: Object.freeze({
			maximumApertureVertexCount: maximumVisibilityApertureVertexCount,
			maximumFragmentCount: 1 + maximumMeteredFragmentCount,
			maximumTemporaryFragmentCount: Math.max(1, maximumMeteredFragmentCount),
			maximumTemporaryVertexCount: Math.max(
				PORTAL_ROOT_WINDOW_VERTEX_COUNT,
				selection.maximumProjectionPrimitiveCount,
				maximumVerticesPerFragment,
			),
			maximumVertexCount:
				PORTAL_ROOT_WINDOW_VERTEX_COUNT +
				selection.maximumProjectionPrimitiveCount,
			maximumVerticesPerFragment,
			maximumWindowCount,
		}),
	}) satisfies PortalScopeWindowCullerCapacity;
	return Object.freeze({
		...selection,
		culler,
		scopeAtlas: Object.freeze({ ...selection.scopeAtlas }),
	});
}

function validateSelection(selection: PortalRenderCapacitySelection): void {
	for (const [name, value, minimum] of [
		[
			"maximumAuthoredApertureVertexCount",
			selection.maximumAuthoredApertureVertexCount,
			3,
		],
		["maximumPathDepth", selection.maximumPathDepth, 0],
		[
			"maximumProjectionPrimitiveCount",
			selection.maximumProjectionPrimitiveCount,
			1,
		],
		[
			"maximumScopeWindowWorkItemCount",
			selection.maximumScopeWindowWorkItemCount,
			1,
		],
		["scopeAtlas.columnCount", selection.scopeAtlas.columnCount, 1],
		[
			"scopeAtlas.maximumCrossingTriangleVertexCount",
			selection.scopeAtlas.maximumCrossingTriangleVertexCount,
			3,
		],
		[
			"scopeAtlas.maximumArrivalStateCount",
			selection.scopeAtlas.maximumArrivalStateCount,
			1,
		],
		[
			"scopeAtlas.maximumTargetByteLength",
			selection.scopeAtlas.maximumTargetByteLength,
			1,
		],
		["scopeAtlas.rowCount", selection.scopeAtlas.rowCount, 1],
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
	scopeAtlas: {
		columnCount: 2,
		maximumCrossingTriangleVertexCount: 2_048,
		maximumArrivalStateCount: PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
		// The traced 2560x1080 production extent consumes 215,654,400 bytes. This binary
		// 256 MiB ceiling admits that corpus while rejecting untraced 4K/high-DPI allocations.
		maximumTargetByteLength: 256 * 1024 * 1024,
		rowCount: 3,
	},
});
