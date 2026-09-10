import type { PortalScopeWindowCullerCapacity } from "./portal-scope-window-culler";
import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";
import { PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT } from "./portal-window-arena";

/** Independent limits selected from Gate C and the archive-wide authored-geometry census. */
interface PortalRenderCapacityLimits {
	/** Archive-wide maximum authored source-aperture vertex count. */
	readonly maximumAuthoredApertureVertexCount: number;
	/** Maximum GPU propagation rounds; independent of CPU cell traversal. */
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

/** Derive bounded rectangle storage and aperture scratch from independently selected limits. */
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
	// Rectangular intersections never add polygon edges. Only one aperture is clipped at a time.
	const culler = Object.freeze({
		// Every queued item advances at most one level. The queue/work budget already bounds
		// CPU depth; the GPU propagation limit must not truncate intra-island cell traversal.
		maximumDepth: selection.maximumScopeWindowWorkItemCount,
		maximumProjectionPrimitiveCount: selection.maximumProjectionPrimitiveCount,
		maximumWorkItemCount: selection.maximumScopeWindowWorkItemCount,
		windowArena: Object.freeze({
			maximumApertureVertexCount: maximumVisibilityApertureVertexCount,
			maximumVerticesPerFragment: maximumProjectedApertureFragmentVertexCount,
			maximumWindowCount: selection.maximumScopeWindowWorkItemCount + 1,
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
		rowCount: 3,
	},
});
